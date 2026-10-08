using System.Data;
using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Storage;

namespace Planora.Todo.Infrastructure.Persistence;

/// <summary>Read-only PostgreSQL checks for the exact EF tables, keys and indexes used by Todo.</summary>
internal static class TodoSchemaCompatibility
{
    private sealed record Column(string Type, bool Nullable, bool Supplied, string? DefaultExpression);
    private sealed record Index(string Name, bool Primary, bool Unique, bool Valid, bool Partial, string[] Columns);
    private sealed record ForeignKey(string Name, string PrincipalSchema, string PrincipalTable, string Action, string[] Columns, string[] PrincipalColumns);

    internal static async Task VerifyAsync(TodoDbContext db, IModel model, IModel currentModel, bool allowWiderTitle, CancellationToken cancellationToken)
    {
        var tables = model.GetRelationalModel().Tables;
        var currentTables = currentModel.GetRelationalModel().Tables;
        var connection = db.Database.GetDbConnection();
        var opened = connection.State != ConnectionState.Open;
        if (opened) await connection.OpenAsync(cancellationToken);
        try
        {
            foreach (var table in tables)
            {
                var columns = new Dictionary<string, Column>(StringComparer.Ordinal);
                await using (var query = Query(db, table, """
                    SELECT a.attname, pg_catalog.format_type(a.atttypid,a.atttypmod), NOT a.attnotnull,
                           a.attnum < 0 OR a.atthasdef OR a.attgenerated <> '' OR a.attidentity <> '', pg_catalog.pg_get_expr(d.adbin,d.adrelid)
                    FROM pg_catalog.pg_attribute a
                    JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
                    WHERE n.nspname=@schema AND c.relname=@table AND c.relkind IN ('r','p')
                      AND a.attnum <> 0 AND NOT a.attisdropped
                    """))
                {
                    await using var reader = await query.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                        columns.Add(reader.GetString(0), new(reader.GetString(1), reader.GetBoolean(2), reader.GetBoolean(3), reader.IsDBNull(4) ? null : reader.GetString(4)));
                }
                if (columns.Count == 0) throw TodoDatabaseStartup.Incompatible($"required table {table.Schema}.{table.Name} is missing");
                var mapped = table.Columns.ToDictionary(column => column.Name, StringComparer.Ordinal);
                var current = currentTables.SingleOrDefault(t => t.Schema == table.Schema && t.Name == table.Name);
                foreach (var column in mapped.Values)
                {
                    if (!columns.TryGetValue(column.Name, out var actual)) throw TodoDatabaseStartup.Incompatible($"required column {table.Name}.{column.Name} is missing");
                    VerifyColumn(table, column, actual, allowWiderTitle);
                }
                // Already-present additive columns are allowed only with their reviewed types.
                foreach (var column in columns.Where(column => !mapped.ContainsKey(column.Key)))
                {
                    var next = current?.Columns.SingleOrDefault(c => c.Name == column.Key);
                    if (next is not null) VerifyColumn(table, next, column.Value, allowWiderTitle);
                    else if (!column.Value.Nullable && !column.Value.Supplied)
                        throw TodoDatabaseStartup.Incompatible($"unmapped required column {table.Name}.{column.Key} has no database-supplied value");
                }

                var indexes = new List<Index>();
                await using (var query = Query(db, table, """
                    SELECT x.relname,i.indisprimary,i.indisunique,i.indisvalid,
                           i.indpred IS NOT NULL OR i.indexprs IS NOT NULL,
                           array_agg(COALESCE(a.attname::text, '') ORDER BY k.ordinality)
                    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
                    JOIN pg_catalog.pg_class x ON x.oid=i.indexrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                    JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) ON TRUE
                    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
                    WHERE n.nspname=@schema AND c.relname=@table AND k.ordinality<=i.indnkeyatts
                    GROUP BY x.relname,i.indisprimary,i.indisunique,i.indisvalid,i.indpred,i.indexprs
                    """))
                {
                    await using var reader = await query.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                        indexes.Add(new(reader.GetString(0), reader.GetBoolean(1), reader.GetBoolean(2), reader.GetBoolean(3), reader.GetBoolean(4), reader.GetFieldValue<string[]>(5)));
                }
                if (table.PrimaryKey is not null && !indexes.Any(i => i.Primary && i.Valid && !i.Partial && i.Columns.SequenceEqual(table.PrimaryKey.Columns.Select(c => c.Name))))
                    throw TodoDatabaseStartup.Incompatible($"table {table.Name} lacks its reviewed primary key");
                foreach (var index in table.Indexes)
                    if (!indexes.Any(i => Matches(index, i)))
                        throw TodoDatabaseStartup.Incompatible($"index {index.Name} is missing or incompatible");
                // IF NOT EXISTS cannot silently accept a conflicting name for a new migration index.
                if (current is not null)
                    foreach (var index in current.Indexes.Where(index => !table.Indexes.Any(old => old.Name == index.Name)))
                        if (indexes.Any(i => i.Name == index.Name && !Matches(index, i)))
                            throw TodoDatabaseStartup.Incompatible($"pending index {index.Name} has a conflicting definition");

                var foreignKeys = new List<ForeignKey>();
                await using (var query = Query(db, table, """
                    SELECT fk.conname,pn.nspname,p.relname,fk.confdeltype::text,
                           array_agg(COALESCE(a.attname::text, '') ORDER BY k.ordinality),
                           array_agg(pa.attname::text ORDER BY k.ordinality)
                    FROM pg_catalog.pg_constraint fk
                    JOIN pg_catalog.pg_class c ON c.oid=fk.conrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                    JOIN pg_catalog.pg_class p ON p.oid=fk.confrelid
                    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.relnamespace
                    JOIN LATERAL unnest(fk.conkey,fk.confkey) WITH ORDINALITY k(attnum,pattnum,ordinality) ON TRUE
                    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
                    JOIN pg_catalog.pg_attribute pa ON pa.attrelid=p.oid AND pa.attnum=k.pattnum
                    WHERE n.nspname=@schema AND c.relname=@table AND fk.contype='f' AND fk.convalidated
                    GROUP BY fk.conname,pn.nspname,p.relname,fk.confdeltype
                    """))
                {
                    await using var reader = await query.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                        foreignKeys.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetFieldValue<string[]>(4), reader.GetFieldValue<string[]>(5)));
                }
                foreach (var fk in table.ForeignKeyConstraints)
                {
                    var action = fk.OnDeleteAction switch { ReferentialAction.Cascade => "c", ReferentialAction.Restrict => "r", ReferentialAction.SetNull => "n", ReferentialAction.SetDefault => "d", _ => "a" };
                    if (!foreignKeys.Any(actual => actual.Name == fk.Name && actual.PrincipalSchema == (fk.PrincipalTable.Schema ?? "public") && actual.PrincipalTable == fk.PrincipalTable.Name && actual.Action == action && actual.Columns.SequenceEqual(fk.Columns.Select(c => c.Name)) && actual.PrincipalColumns.SequenceEqual(fk.PrincipalColumns.Select(c => c.Name))))
                        throw TodoDatabaseStartup.Incompatible($"foreign key {fk.Name} is missing or incompatible");
                }
            }
        }
        finally { if (opened) await connection.CloseAsync(); }
    }

    private static bool Matches(ITableIndex expected, Index actual) => actual.Name == expected.Name && actual.Unique == expected.IsUnique && actual.Valid && !actual.Partial && actual.Columns.SequenceEqual(expected.Columns.Select(c => c.Name));

    private static void VerifyColumn(ITable table, IColumn expected, Column actual, bool allowWiderTitle)
    {
        var matches = string.Equals(expected.StoreType, actual.Type, StringComparison.OrdinalIgnoreCase);
        if (!matches && allowWiderTitle && table.Name == "TodoItems" && expected.Name == "Title" && expected.StoreType == "character varying(200)")
            matches = actual.Type.StartsWith("character varying(", StringComparison.Ordinal) && int.TryParse(actual.Type[18..^1], out var length) && length is >= 200 and <= 1500;
        if (!matches || actual.Nullable != expected.IsNullable)
            throw TodoDatabaseStartup.Incompatible($"column {table.Name}.{expected.Name} has incompatible type or nullability");
        var expectedDefault = expected.DefaultValueSql;
        if (expectedDefault is null && expected.DefaultValue is not null)
            expectedDefault = expected.StoreTypeMapping.GenerateProviderValueSqlLiteral(expected.DefaultValue);
        if (expectedDefault is not null && (actual.DefaultExpression is null ||
            !string.Equals(NormalizeDefault(expectedDefault), NormalizeDefault(actual.DefaultExpression), StringComparison.Ordinal)))
            throw TodoDatabaseStartup.Incompatible($"column {table.Name}.{expected.Name} has an incompatible database default");
    }

    // Compare stored expressions without executing a database-provided default/function.
    // PostgreSQL decorates literal defaults with casts; preserve case inside string literals.
    private static string NormalizeDefault(string expression)
    {
        var value = expression.Trim();
        value = System.Text.RegularExpressions.Regex.Replace(value,
            @"::(?:boolean|integer|text|character varying(?:\(\d+\))?)$", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();
        while (value.Length > 1 && value[0] == '(' && value[^1] == ')') value = value[1..^1].Trim();
        return value.Equals("true", StringComparison.OrdinalIgnoreCase) ? "true" :
            value.Equals("false", StringComparison.OrdinalIgnoreCase) ? "false" : value;
    }
    private static DbCommand Query(TodoDbContext db, ITable table, string sql)
    {
        var query = db.Database.GetDbConnection().CreateCommand(); query.CommandText = sql;
        query.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        Add(query, "schema", table.Schema ?? "public"); Add(query, "table", table.Name); return query;
    }
    private static void Add(DbCommand query, string name, string value)
    {
        var parameter = query.CreateParameter(); parameter.ParameterName = name; parameter.Value = value; query.Parameters.Add(parameter);
    }
}
