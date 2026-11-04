using System.Data.Common;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

namespace Planora.BuildingBlocks.Infrastructure.Persistence;

/// <summary>Read-only catalog equivalence checks for reviewed PostgreSQL migration models.</summary>
public static class PostgreSqlSchemaCompatibility
{
    private sealed record Column(string Type, bool Nullable, string? Default, string Identity, string Generated,
        string? Collation, string? CollationSchema);
    private sealed record Index(string Name, bool Primary, bool Unique, bool Valid, string Method,
        string? Filter, string[] Columns, short[] Options, bool Expression, bool IncludesColumns,
        bool DefaultOperators, bool ColumnCollations, bool NullsNotDistinct);
    private sealed record Constraint(string Name, string Kind, bool Valid, bool Deferrable, bool Deferred,
        string[] Columns, string? PrincipalSchema, string? PrincipalTable, string[] PrincipalColumns,
        string DeleteAction, string UpdateAction, string? Check, string MatchType);

    public static async Task VerifyAsync(DbContext db, IModel model, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!db.Database.IsNpgsql()) throw new InvalidOperationException("Schema verification requires PostgreSQL.");
        var tables = model.GetRelationalModel().Tables.ToArray();
        await using var catalog = await PostgreSqlCatalogScope.OpenAsync(db, cancellationToken);
        try
        {
            await PostgreSqlPreparationObjects.VerifyAsync(db, cancellationToken);
            var observedTables = new HashSet<(string Schema, string Name)>();
            await using (var query = Query(db, """
                SELECT n.nspname,c.relname,c.relkind::text,c.relpersistence::text,
                       c.relrowsecurity OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy pol WHERE pol.polrelid=c.oid),c.relforcerowsecurity,
                       EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND (NOT t.tgisinternal OR t.tgenabled<>'O')),
                       EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite r WHERE r.ev_class=c.oid)
                FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
                  AND n.oid<>pg_catalog.pg_my_temp_schema() AND NOT pg_catalog.pg_is_other_temp_schema(n.oid)
                  AND c.relkind IN ('r','p','v','m','f')
                  AND NOT (n.nspname='public' AND c.relname='__EFMigrationsHistory')
                """))
            {
                await using var reader = await query.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    var name = (reader.GetString(0), reader.GetString(1));
                    observedTables.Add(name);
                    if (reader.GetString(2) != "r" || reader.GetString(3) != "p" || reader.GetBoolean(4) || reader.GetBoolean(5) ||
                        reader.GetBoolean(6) || reader.GetBoolean(7))
                        throw Incompatible($"table {name.Item1}.{name.Item2} has an unreviewed kind, security policy, trigger or rule");
                }
            }
            if (!observedTables.SetEquals(tables.Select(t => (t.Schema ?? "public", t.Name))))
                throw Incompatible("the database table set differs from the reviewed model");

            foreach (var table in tables)
            {
                var columns = new Dictionary<string, Column>(StringComparer.Ordinal);
                await using (var query = Query(db, """
                    SELECT a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),NOT a.attnotnull,
                           pg_catalog.pg_get_expr(d.adbin,d.adrelid),a.attidentity::text,a.attgenerated::text,coll.collname,coll_ns.nspname
                    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
                    LEFT JOIN pg_catalog.pg_collation coll ON coll.oid=a.attcollation
                    LEFT JOIN pg_catalog.pg_namespace coll_ns ON coll_ns.oid=coll.collnamespace
                    WHERE n.nspname=@schema AND c.relname=@table AND NOT a.attisdropped
                      AND (a.attnum>0 OR a.attname='xmin')
                    """, table))
                {
                    await using var reader = await query.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                        columns.Add(reader.GetString(0), new(reader.GetString(1), reader.GetBoolean(2),
                            NullableString(reader, 3), reader.GetString(4), reader.GetString(5), NullableString(reader, 6), NullableString(reader, 7)));
                }
                var mapped = table.Columns.ToDictionary(c => c.Name, StringComparer.Ordinal);
                if (!mapped.ContainsKey("xmin")) columns.Remove("xmin");
                if (!columns.Keys.ToHashSet(StringComparer.Ordinal).SetEquals(mapped.Keys))
                    throw Incompatible($"table {table.Name} has missing or unreviewed columns");
                foreach (var expected in mapped.Values)
                    VerifyColumn(table, expected, columns[expected.Name]);

                await VerifyExpressionDependencies(db, table, cancellationToken);

                var indexes = new List<Index>();
                await using (var query = Query(db, """
                    SELECT ix.relname,i.indisprimary,i.indisunique,i.indisvalid,am.amname,
                           pg_catalog.pg_get_expr(i.indpred,i.indrelid),
                           ARRAY(SELECT COALESCE(a.attname::text,'') FROM pg_catalog.unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
                                 LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
                                 WHERE k.ord<=i.indnkeyatts ORDER BY k.ord),
                           ARRAY(SELECT option FROM pg_catalog.unnest(i.indoption) WITH ORDINALITY x(option,ord) ORDER BY ord),
                           i.indexprs IS NOT NULL,i.indnatts<>i.indnkeyatts,
                           NOT EXISTS(SELECT 1 FROM pg_catalog.unnest(i.indclass) x(opclass)
                                      JOIN pg_catalog.pg_opclass op ON op.oid=x.opclass
                                      JOIN pg_catalog.pg_namespace ns ON ns.oid=op.opcnamespace
                                      WHERE NOT op.opcdefault OR ns.nspname<>'pg_catalog'),
                           NOT EXISTS(SELECT 1 FROM pg_catalog.unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
                                      LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
                                      WHERE k.ord<=i.indnkeyatts AND i.indcollation[k.ord-1]<>COALESCE(a.attcollation,0)),
                           i.indnullsnotdistinct
                    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                    JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid JOIN pg_catalog.pg_am am ON am.oid=ix.relam
                    WHERE n.nspname=@schema AND c.relname=@table
                    """, table))
                {
                    await using var reader = await query.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                        indexes.Add(new(reader.GetString(0), reader.GetBoolean(1), reader.GetBoolean(2), reader.GetBoolean(3),
                            reader.GetString(4), NullableString(reader, 5), reader.GetFieldValue<string[]>(6),
                            reader.GetFieldValue<short[]>(7), reader.GetBoolean(8), reader.GetBoolean(9),
                            reader.GetBoolean(10), reader.GetBoolean(11), reader.GetBoolean(12)));
                }
                var expectedIndexNames = table.Indexes.Select(i => i.Name)
                    .Concat(table.UniqueConstraints.Select(c => c.Name))
                    .Concat(table.PrimaryKey is null ? [] : new[] { table.PrimaryKey.Name }).ToHashSet(StringComparer.Ordinal);
                if (!expectedIndexNames.SetEquals(indexes.Select(i => i.Name)))
                    throw Incompatible($"table {table.Name} has missing or unreviewed indexes");
                foreach (var expected in table.Indexes)
                {
                    var actual = indexes.Single(i => i.Name == expected.Name);
                    var descending = expected.IsDescending;
                    var expectedOptions = expected.Columns.Select((_, i) =>
                        (short)(descending is not null && (descending.Count == 0 || descending[i]) ? 3 : 0));
                    if (actual.Primary || actual.Unique != expected.IsUnique || !actual.Valid || actual.Expression || actual.IncludesColumns ||
                        !actual.DefaultOperators || !actual.ColumnCollations ||
                        actual.NullsNotDistinct != !(expected.FindAnnotation("Npgsql:NullsDistinct")?.Value as bool? ?? true) ||
                        actual.Method != (expected.FindAnnotation("Npgsql:IndexMethod")?.Value as string ?? "btree") ||
                        !actual.Columns.SequenceEqual(expected.Columns.Select(c => c.Name)) || !actual.Options.SequenceEqual(expectedOptions) ||
                        !EquivalentExpression(expected.Filter, actual.Filter))
                        throw Incompatible($"index {expected.Name} differs from its reviewed definition");
                }

                var constraints = new List<Constraint>();
                await using (var query = Query(db, """
                    SELECT k.conname,k.contype::text,k.convalidated,k.condeferrable,k.condeferred,
                           ARRAY(SELECT a.attname::text FROM pg_catalog.unnest(k.conkey) WITH ORDINALITY x(num,ord)
                                 JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.num ORDER BY x.ord),
                           pn.nspname,p.relname,
                           ARRAY(SELECT a.attname::text FROM pg_catalog.unnest(k.confkey) WITH ORDINALITY x(num,ord)
                                 JOIN pg_catalog.pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.num ORDER BY x.ord),
                           k.confdeltype::text,k.confupdtype::text,pg_catalog.pg_get_expr(k.conbin,k.conrelid),k.confmatchtype::text
                    FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                    LEFT JOIN pg_catalog.pg_class p ON p.oid=k.confrelid
                    LEFT JOIN pg_catalog.pg_namespace pn ON pn.oid=p.relnamespace
                    WHERE n.nspname=@schema AND c.relname=@table
                    """, table))
                {
                    await using var reader = await query.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                        constraints.Add(new(reader.GetString(0), reader.GetString(1), reader.GetBoolean(2), reader.GetBoolean(3),
                            reader.GetBoolean(4), reader.GetFieldValue<string[]>(5), NullableString(reader, 6), NullableString(reader, 7),
                            reader.GetFieldValue<string[]>(8), reader.GetString(9), reader.GetString(10), NullableString(reader, 11), reader.GetString(12)));
                }
                var unique = table.UniqueConstraints.Concat(table.PrimaryKey is null ? [] : new[] { table.PrimaryKey })
                    .DistinctBy(k => k.Name).ToArray();
                var expectedConstraintNames = unique.Select(c => c.Name).Concat(table.ForeignKeyConstraints.Select(c => c.Name))
                    .Concat(table.CheckConstraints.Select(c => c.Name)).ToHashSet(StringComparer.Ordinal);
                if (!expectedConstraintNames.SetEquals(constraints.Select(c => c.Name)) ||
                    constraints.Any(c => !c.Valid || c.Deferrable || c.Deferred))
                    throw Incompatible($"table {table.Name} has missing or unreviewed constraints");
                foreach (var expected in unique)
                {
                    var actual = constraints.Single(c => c.Name == expected.Name);
                    var index = indexes.Single(i => i.Name == expected.Name);
                    var primary = table.PrimaryKey?.Name == expected.Name;
                    if (actual.Kind != (primary ? "p" : "u") || !actual.Columns.SequenceEqual(expected.Columns.Select(c => c.Name)) ||
                        index.Primary != primary || !index.Unique || !index.Valid || index.Expression || index.IncludesColumns ||
                        index.Filter is not null || index.Method != "btree" || index.Options.Any(o => o != 0) ||
                        !index.DefaultOperators || !index.ColumnCollations || index.NullsNotDistinct)
                        throw Incompatible($"key {expected.Name} differs from its reviewed definition");
                }
                foreach (var expected in table.ForeignKeyConstraints)
                {
                    var actual = constraints.Single(c => c.Name == expected.Name);
                    var action = expected.OnDeleteAction switch
                    {
                        ReferentialAction.Cascade => "c", ReferentialAction.Restrict => "r", ReferentialAction.SetNull => "n",
                        ReferentialAction.SetDefault => "d", _ => "a"
                    };
                    if (actual.Kind != "f" || actual.MatchType != "s" || actual.DeleteAction != action || actual.UpdateAction != "a" ||
                        actual.PrincipalSchema != (expected.PrincipalTable.Schema ?? "public") || actual.PrincipalTable != expected.PrincipalTable.Name ||
                        !actual.Columns.SequenceEqual(expected.Columns.Select(c => c.Name)) ||
                        !actual.PrincipalColumns.SequenceEqual(expected.PrincipalColumns.Select(c => c.Name)))
                        throw Incompatible($"foreign key {expected.Name} differs from its reviewed definition");
                }
                foreach (var expected in table.CheckConstraints)
                {
                    var actual = constraints.Single(c => c.Name == expected.Name);
                    if (actual.Kind != "c" || !EquivalentExpression(expected.Sql, actual.Check))
                        throw Incompatible($"check constraint {expected.Name} differs from its reviewed definition");
                }
            }
        }
        catch (Exception error)
        {
            await catalog.DisposeAsync(error);
            throw;
        }
    }

    internal static async Task<bool> VerifyPreparationObjectsAsync(DbContext db, CancellationToken cancellationToken)
    {
        await using var catalog = await PostgreSqlCatalogScope.OpenAsync(db, cancellationToken);
        try { return await PostgreSqlPreparationObjects.VerifyAsync(db, cancellationToken); }
        catch (Exception error)
        {
            await catalog.DisposeAsync(error);
            throw;
        }
    }

    private static void VerifyColumn(ITable table, IColumn expected, Column actual)
    {
        var store = StoreObjectIdentifier.Table(table.Name, table.Schema);
        if (expected.PropertyMappings.Any(mapping => mapping.Property.GetValueGenerationStrategy(store) != NpgsqlValueGenerationStrategy.None))
            throw Incompatible($"column {table.Name}.{expected.Name} uses generation outside the reviewed schema profile");
        if (!string.Equals(expected.StoreType, actual.Type, StringComparison.OrdinalIgnoreCase) || expected.IsNullable != actual.Nullable ||
            !string.IsNullOrEmpty(actual.Identity) || !string.IsNullOrEmpty(actual.Generated) || expected.ComputedColumnSql is not null ||
            !MatchesCollation(expected.Collation, actual.CollationSchema, actual.Collation))
            throw Incompatible($"column {table.Name}.{expected.Name} has an unreviewed type, nullability or generation/collation setting");
        var expectedDefault = expected.DefaultValueSql;
        if (expectedDefault is null && expected.DefaultValue is not null)
            expectedDefault = expected.StoreTypeMapping.GenerateProviderValueSqlLiteral(expected.DefaultValue);
        if (!EquivalentExpression(expectedDefault, actual.Default))
            throw Incompatible($"column {table.Name}.{expected.Name} has an unreviewed database default");
    }

    private static bool MatchesCollation(string? expected, string? schema, string? name)
    {
        if (expected is null) return name is null || schema == "pg_catalog" && name == "default";
        var parts = expected.Split('.');
        return parts.Length == 1 ? schema == "pg_catalog" && name == parts[0] :
            parts.Length == 2 && schema == parts[0] && name == parts[1];
    }

    private static async Task VerifyExpressionDependencies(DbContext db, ITable table, CancellationToken cancellationToken)
    {
        await using var query = Query(db, """
            SELECT EXISTS(
              SELECT 1 FROM pg_catalog.pg_depend d
              LEFT JOIN pg_catalog.pg_proc p ON d.refclassid='pg_catalog.pg_proc'::pg_catalog.regclass AND p.oid=d.refobjid
              LEFT JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
              LEFT JOIN pg_catalog.pg_operator op ON d.refclassid='pg_catalog.pg_operator'::pg_catalog.regclass AND op.oid=d.refobjid
              LEFT JOIN pg_catalog.pg_namespace opn ON opn.oid=op.oprnamespace
              LEFT JOIN pg_catalog.pg_collation col ON d.refclassid='pg_catalog.pg_collation'::pg_catalog.regclass AND col.oid=d.refobjid
              LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=col.collnamespace
              LEFT JOIN pg_catalog.pg_type t ON d.refclassid='pg_catalog.pg_type'::pg_catalog.regclass AND t.oid=d.refobjid
              LEFT JOIN pg_catalog.pg_namespace tn ON tn.oid=t.typnamespace
              WHERE (pn.nspname<>'pg_catalog' OR opn.nspname<>'pg_catalog' OR cn.nspname<>'pg_catalog' OR tn.nspname<>'pg_catalog')
                AND (
                  d.classid='pg_catalog.pg_attrdef'::pg_catalog.regclass AND d.objid IN(
                    SELECT a.oid FROM pg_catalog.pg_attrdef a JOIN pg_catalog.pg_class c ON c.oid=a.adrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=@schema AND c.relname=@table)
                  OR d.classid='pg_catalog.pg_constraint'::pg_catalog.regclass AND d.objid IN(
                    SELECT k.oid FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=@schema AND c.relname=@table)
                  OR d.classid='pg_catalog.pg_class'::pg_catalog.regclass AND d.objid IN(
                    SELECT i.indexrelid FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=@schema AND c.relname=@table)
                ))
            """, table);
        if ((bool)(await query.ExecuteScalarAsync(cancellationToken))!)
            throw Incompatible($"table {table.Name} has an unreviewed default, collation or expression dependency");
    }

    internal static bool EquivalentExpression(string? expected, string? actual)
    {
        if (expected is null || actual is null) return expected == actual;
        if (expected.Length > 16_384 || actual.Length > 16_384) return false;
        var expectedTokens = CanonicalTokens(expected);
        var actualTokens = CanonicalTokens(actual);
        if (expectedTokens.SequenceEqual(actualTokens)) return true;
        // PostgreSQL renders the reviewed string-enum polling predicate as an ANY array.
        // Only text coercion of this known string column is accepted; operand casts are never erased generally.
        return string.Concat(expectedTokens) == "\"Status\"in('Pending','Failed')" && IsReviewedActivePredicate(actualTokens);
    }

    // Compare syntax only. Database-provided defaults and predicates are never executed.
    private static List<string> CanonicalTokens(string sql)
    {
        var tokens = new List<string>();
        for (var i = 0; i < sql.Length;)
        {
            if (char.IsWhiteSpace(sql[i])) { i++; continue; }
            var start = i;
            if (sql[i] is '\'' or '"')
            {
                var quote = sql[i++];
                var closed = false;
                while (i < sql.Length)
                {
                    if (sql[i++] != quote) continue;
                    if (i < sql.Length && sql[i] == quote) { i++; continue; }
                    closed = true; break;
                }
                if (!closed) throw Incompatible("an expression could not be safely compared");
                tokens.Add(sql[start..i]);
            }
            else if (char.IsLetterOrDigit(sql[i]) || sql[i] == '_')
            {
                while (i < sql.Length && (char.IsLetterOrDigit(sql[i]) || sql[i] == '_')) i++;
                tokens.Add(sql[start..i].ToLowerInvariant());
            }
            else if (sql[i] == ':' && i + 1 < sql.Length && sql[i + 1] == ':') { tokens.Add("::"); i += 2; }
            else tokens.Add(sql[i++].ToString());
        }
        for (var i = 0; i + 1 < tokens.Count; i++)
        {
            if (tokens[i] != "::" || i == 0 || !tokens[i - 1].StartsWith('\'')) continue;
            var length = tokens[i + 1] == "text" ? 2 :
                i + 2 < tokens.Count && tokens[i + 1] == "character" && tokens[i + 2] == "varying" ? 3 : 0;
            if (length == 0 || i + length < tokens.Count && tokens[i + length] == "(") continue;
            if (i + length < tokens.Count && tokens[i + length] == "[") continue;
            tokens.RemoveRange(i, length); i--;
        }
        tokens = WithoutOuterParentheses(tokens);
        while (tokens.Count > 2 && tokens[^2] == "::")
        {
            var literal = WithoutOuterParentheses(tokens.GetRange(0, tokens.Count - 2));
            var integer = string.Concat(literal);
            var safe = tokens[^1] == "boolean" && literal.Count == 1 && (literal[0] is "true" or "false") ||
                tokens[^1] == "integer" && int.TryParse(integer, System.Globalization.NumberStyles.AllowLeadingSign,
                    System.Globalization.CultureInfo.InvariantCulture, out _);
            if (!safe) break;
            tokens = literal;
        }
        return tokens;
    }

    private static List<string> WithoutOuterParentheses(List<string> tokens)
    {
        while (tokens.Count > 1 && tokens[0] == "(" && tokens[^1] == ")")
        {
            var depth = 0; var enclosesAll = true;
            for (var i = 0; i < tokens.Count - 1; i++)
            {
                if (tokens[i] == "(") depth++;
                if (tokens[i] == ")") depth--;
                if (depth == 0) { enclosesAll = false; break; }
            }
            if (!enclosesAll) break;
            tokens.RemoveAt(tokens.Count - 1); tokens.RemoveAt(0);
        }
        return tokens;
    }

    private static bool IsReviewedActivePredicate(List<string> tokens)
    {
        var equal = tokens.IndexOf("=");
        if (equal < 1 || !IsStatusOperand(tokens.GetRange(0, equal))) return false;
        var right = tokens.GetRange(equal + 1, tokens.Count - equal - 1);
        return right.Count > 3 && right[0] == "any" && right[1] == "(" && right[^1] == ")" &&
            IsStatusArray(right.GetRange(2, right.Count - 3));
    }

    private static bool IsStatusOperand(List<string> tokens)
    {
        while (true)
        {
            tokens = WithoutOuterParentheses(tokens);
            if (tokens.Count == 1) return tokens[0] == "\"Status\"";
            if (tokens.Count < 3 || tokens[^2] != "::" || tokens[^1] != "text") return false;
            tokens.RemoveRange(tokens.Count - 2, 2);
        }
    }

    private static bool IsStatusArray(List<string> tokens)
    {
        while (true)
        {
            tokens = WithoutOuterParentheses(tokens);
            if (tokens.SequenceEqual(new[] { "array", "[", "'Pending'", ",", "'Failed'", "]" })) return true;
            if (tokens.Count < 5 || tokens[^4] != "::" || tokens[^3] != "text" || tokens[^2] != "[" || tokens[^1] != "]") return false;
            tokens.RemoveRange(tokens.Count - 4, 4);
        }
    }

    private static string? NullableString(DbDataReader reader, int index) => reader.IsDBNull(index) ? null : reader.GetString(index);
    internal static DatabaseSchemaCompatibilityException Incompatible(string detail) =>
        new("Database schema is incompatible: " + detail + ". Preparation stopped; preserve data and use a reviewed migration or restore plan.");

    private static DbCommand Query(DbContext db, string sql, ITable? table = null)
    {
        var query = db.Database.GetDbConnection().CreateCommand();
        query.CommandText = sql;
        query.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        if (table is not null)
        {
            Add(query, "schema", table.Schema ?? "public"); Add(query, "table", table.Name);
        }
        return query;
    }

    private static void Add(DbCommand query, string name, string value)
    {
        var parameter = query.CreateParameter(); parameter.ParameterName = name; parameter.Value = value; query.Parameters.Add(parameter);
    }
}

public sealed class DatabaseSchemaCompatibilityException : InvalidOperationException
{
    internal DatabaseSchemaCompatibilityException(string message) : base(message) { }
}
