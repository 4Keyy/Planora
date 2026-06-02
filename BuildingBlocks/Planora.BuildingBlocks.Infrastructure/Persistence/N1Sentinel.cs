using System.Collections.Concurrent;
using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Planora.BuildingBlocks.Infrastructure.Persistence;

/// <summary>
/// EF Core command interceptor that fingerprints every SQL command issued within
/// a logical scope and surfaces (or fails) when the same fingerprint executes
/// more than the configured threshold within that scope. The canonical N+1
/// regression pattern.
/// </summary>
/// <remarks>
/// Scope is the AsyncLocal "session" started by <see cref="BeginScope"/>. Tests
/// wrap the integration call under test in a using-block; production code never
/// begins a scope, so the interceptor is a no-op outside the test factory and
/// has zero runtime impact when not enabled.
///
/// Fingerprint = normalised SQL text (parameters stripped, whitespace
/// collapsed). Two reads of <c>SELECT * FROM Users WHERE Id = $1</c> with
/// different <c>Id</c>s collapse to the same fingerprint — that's the whole
/// point: an N+1 emits the same shape N times.
///
/// Whitelist entries are SQL substrings; if the normalised command text
/// contains any whitelisted substring, repeats of that fingerprint do not
/// count toward the threshold. Use for legitimately repeated reads (e.g. a
/// foreach loop the author knows is correct).
/// </remarks>
public sealed class N1SentinelInterceptor : DbCommandInterceptor
{
    private static readonly AsyncLocal<Scope?> Current = new();

    /// <summary>
    /// Begin a new sentinel scope. Disposing the returned handle restores
    /// the previous (usually null) scope and asserts the threshold.
    /// </summary>
    /// <param name="threshold">Maximum allowed repeats of the same SQL fingerprint
    /// within this scope. Anything past the threshold triggers <paramref name="onViolation"/>.</param>
    /// <param name="onViolation">Callback invoked on Dispose if a violation was
    /// observed. Throws <see cref="N1SentinelException"/> by default; tests can
    /// substitute a collector instead.</param>
    /// <param name="whitelist">Case-insensitive SQL substrings that exempt
    /// matching fingerprints from the count.</param>
    public static IDisposable BeginScope(
        int threshold = 5,
        Action<IReadOnlyList<N1Violation>>? onViolation = null,
        IReadOnlyCollection<string>? whitelist = null)
    {
        var previous = Current.Value;
        var scope = new Scope(threshold, onViolation ?? DefaultOnViolation, whitelist ?? Array.Empty<string>());
        Current.Value = scope;
        return new ScopeHandle(scope, previous);
    }

    private static void DefaultOnViolation(IReadOnlyList<N1Violation> violations)
    {
        var summary = string.Join("; ", violations.Select(v => $"{v.RepeatCount}× {Trim(v.Fingerprint)}"));
        throw new N1SentinelException($"N+1 query pattern detected: {summary}");
    }

    private static string Trim(string text) => text.Length <= 100 ? text : text[..100] + "…";

    public override InterceptionResult<DbDataReader> ReaderExecuting(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result)
    {
        Record(command.CommandText);
        return base.ReaderExecuting(command, eventData, result);
    }

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        Record(command.CommandText);
        return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
    }

    public override InterceptionResult<int> NonQueryExecuting(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<int> result)
    {
        Record(command.CommandText);
        return base.NonQueryExecuting(command, eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Record(command.CommandText);
        return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
    }

    public override InterceptionResult<object> ScalarExecuting(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<object> result)
    {
        Record(command.CommandText);
        return base.ScalarExecuting(command, eventData, result);
    }

    public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<object> result,
        CancellationToken cancellationToken = default)
    {
        Record(command.CommandText);
        return base.ScalarExecutingAsync(command, eventData, result, cancellationToken);
    }

    /// <summary>
    /// Records one command for sentinel accounting. Exposed for direct testing —
    /// production code goes through the EF Core interceptor entry points above,
    /// which call this internally.
    /// </summary>
    public static void RecordCommand(string commandText)
    {
        var scope = Current.Value;
        if (scope is null) return;
        scope.Record(Fingerprint(commandText));
    }

    private static void Record(string commandText) => RecordCommand(commandText);

    /// <summary>
    /// Normalise the SQL: strip $N / @p? parameter placeholders so EF Core's
    /// per-row parameterisation doesn't make every call look unique, and
    /// collapse whitespace runs so trivial formatting differences don't either.
    /// Exposed publicly so the regression tests in `N1SentinelTests` can pin
    /// the fingerprinting contract without resorting to `InternalsVisibleTo`.
    /// </summary>
    public static string Fingerprint(string sql)
    {
        if (string.IsNullOrWhiteSpace(sql)) return string.Empty;
        var span = sql.AsSpan();
        var sb = new System.Text.StringBuilder(sql.Length);
        var inWhitespace = false;
        for (int i = 0; i < span.Length; i++)
        {
            var c = span[i];
            if (c == '$' || c == '@')
            {
                sb.Append('?');
                while (i + 1 < span.Length && (char.IsLetterOrDigit(span[i + 1]) || span[i + 1] == '_'))
                {
                    i++;
                }
                inWhitespace = false;
                continue;
            }
            if (char.IsWhiteSpace(c))
            {
                if (inWhitespace) continue;
                sb.Append(' ');
                inWhitespace = true;
                continue;
            }
            sb.Append(c);
            inWhitespace = false;
        }
        return sb.ToString().Trim();
    }

    private sealed class Scope
    {
        private readonly int _threshold;
        private readonly Action<IReadOnlyList<N1Violation>> _onViolation;
        private readonly IReadOnlyCollection<string> _whitelist;
        private readonly ConcurrentDictionary<string, int> _counts = new();

        public Scope(int threshold, Action<IReadOnlyList<N1Violation>> onViolation, IReadOnlyCollection<string> whitelist)
        {
            _threshold = threshold;
            _onViolation = onViolation;
            _whitelist = whitelist;
        }

        public void Record(string fingerprint)
        {
            if (string.IsNullOrEmpty(fingerprint)) return;
            if (IsWhitelisted(fingerprint)) return;
            _counts.AddOrUpdate(fingerprint, 1, (_, c) => c + 1);
        }

        public IReadOnlyList<N1Violation> Drain()
        {
            return _counts
                .Where(kv => kv.Value > _threshold)
                .Select(kv => new N1Violation(kv.Key, kv.Value))
                .ToList();
        }

        public void RaiseIfViolated()
        {
            var violations = Drain();
            if (violations.Count > 0)
            {
                _onViolation(violations);
            }
        }

        private bool IsWhitelisted(string fingerprint)
        {
            foreach (var pattern in _whitelist)
            {
                if (fingerprint.Contains(pattern, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }
    }

    private sealed class ScopeHandle : IDisposable
    {
        private readonly Scope _scope;
        private readonly Scope? _previous;
        private bool _disposed;

        public ScopeHandle(Scope scope, Scope? previous)
        {
            _scope = scope;
            _previous = previous;
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            try
            {
                _scope.RaiseIfViolated();
            }
            finally
            {
                Current.Value = _previous;
            }
        }
    }
}

public sealed record N1Violation(string Fingerprint, int RepeatCount);

public sealed class N1SentinelException : Exception
{
    public N1SentinelException(string message) : base(message) { }
}
