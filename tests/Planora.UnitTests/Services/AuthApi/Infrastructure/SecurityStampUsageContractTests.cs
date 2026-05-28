using System.Text.RegularExpressions;
using Planora.Auth.Application.Features.Authentication.Handlers.Login;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

/// <summary>
/// T3.5 — contract test that closes the loophole "handler depends on
/// <c>ISecurityStampService</c> but never invokes <c>SetStampAsync</c>".
/// If a future handler injects the service for logging or read-only purposes
/// and silently omits the rotation, the user's old access tokens would remain
/// valid past the security-posture change.
///
/// Implementation note: source-file scanning is used (instead of IL disassembly)
/// to avoid pulling Mono.Cecil into the test dependency graph. Every handler
/// file in <c>Planora.Auth.Application/Features/**/Handlers/</c> is scanned;
/// any file that mentions <c>ISecurityStampService</c> in its constructor
/// parameter list must also contain a call to <c>SetStampAsync</c> somewhere
/// in the same file (the call site is always the handler itself — handlers do
/// not delegate the rotation to helpers).
/// </summary>
public sealed class SecurityStampUsageContractTests
{
    [Fact]
    [Trait("TestType", "Security")]
    public void Every_handler_that_injects_ISecurityStampService_must_call_SetStampAsync()
    {
        var repoRoot = FindRepositoryRoot();
        var handlersRoot = Path.Combine(
            repoRoot,
            "Services", "AuthApi", "Planora.Auth.Application", "Features");

        Assert.True(Directory.Exists(handlersRoot),
            $"Handler root not found: {handlersRoot}");

        var handlerFiles = Directory
            .EnumerateFiles(handlersRoot, "*CommandHandler.cs", SearchOption.AllDirectories)
            .ToList();

        Assert.NotEmpty(handlerFiles);

        // Anchor type forces the application assembly to load so a renamed handler
        // (e.g. CommandHandler → Handler) does not silently cause this test to skip
        // its target if the file-name pattern above ever drifts.
        Assert.NotNull(typeof(LoginCommandHandler).Assembly);

        var violations = new List<string>();
        var injectorsSeen = 0;

        foreach (var file in handlerFiles)
        {
            var source = File.ReadAllText(file);
            if (!ConstructorInjectsSecurityStamp(source))
            {
                continue;
            }

            injectorsSeen++;

            if (!source.Contains("SetStampAsync(", StringComparison.Ordinal))
            {
                violations.Add(Path.GetRelativePath(repoRoot, file));
            }
        }

        // Sanity: if zero handlers ever inject ISecurityStampService, the regex
        // probably drifted — fail loud rather than green-light a vacuous test.
        Assert.True(
            injectorsSeen > 0,
            "No handler files appear to inject ISecurityStampService. " +
            "Either the regex drifted or the convention changed — please update this test.");

        Assert.True(
            violations.Count == 0,
            "The following handlers inject ISecurityStampService but never call SetStampAsync. " +
            "Either invoke SetStampAsync on the user being modified, or remove the dependency. " +
            "Violations: " + string.Join(", ", violations));
    }

    /// <summary>
    /// Matches a public constructor whose parameter list contains
    /// <c>ISecurityStampService</c>. Comments and whitespace inside the
    /// constructor signature are tolerated; multi-line signatures (each
    /// parameter on its own line) are the dominant style in this codebase.
    /// </summary>
    private static bool ConstructorInjectsSecurityStamp(string source)
    {
        // public CtorName( ... ISecurityStampService ... )
        var pattern = new Regex(
            @"public\s+\w+\s*\([^)]*?\bISecurityStampService\b[^)]*\)",
            RegexOptions.Singleline | RegexOptions.Compiled);
        return pattern.IsMatch(source);
    }

    private static string FindRepositoryRoot()
    {
        var current = AppContext.BaseDirectory;
        while (!string.IsNullOrWhiteSpace(current))
        {
            if (File.Exists(Path.Combine(current, "Planora.sln")))
            {
                return current;
            }

            current = Directory.GetParent(current)?.FullName;
        }

        throw new InvalidOperationException(
            "Could not locate Planora.sln from test base directory.");
    }
}
