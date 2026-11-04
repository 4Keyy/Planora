using System.Data.Common;
using Microsoft.EntityFrameworkCore.Storage;

namespace Planora.BuildingBlocks.Infrastructure.Persistence;

/// <summary>Checks preparation infrastructure without selecting from the history relation.</summary>
internal static class PostgreSqlPreparationObjects
{
    internal static async Task<bool> VerifyAsync(DbContext db, CancellationToken cancellationToken)
    {
        if (await Flag(db, "SELECT pg_catalog.current_setting('session_replication_role') <> 'origin'", cancellationToken))
            throw Incompatible("the session replication role must enforce ordinary triggers and foreign keys");
        if (await Flag(db, "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_event_trigger WHERE evtenabled<>'D')", cancellationToken))
            throw Incompatible("an enabled database event trigger is outside the reviewed schema");
        if (await Flag(db, """
            SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_class
                WHERE relnamespace=pg_catalog.pg_my_temp_schema() AND relname='__EFMigrationsHistory')
            """, cancellationToken))
            throw Incompatible("temporary __EFMigrationsHistory shadowing is not supported");

        var exists = false;
        await using (var query = Query(db, """
            SELECT c.relkind::text,c.relpersistence::text,
                   c.relrowsecurity OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy pol WHERE pol.polrelid=c.oid),c.relforcerowsecurity,
                   EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid),
                   EXISTS(SELECT 1 FROM pg_catalog.pg_rewrite r WHERE r.ev_class=c.oid),
                   EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhparent=c.oid OR i.inhrelid=c.oid)
            FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relname='__EFMigrationsHistory'
            """))
        {
            await using var reader = await query.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                exists = true;
                if (reader.GetString(0) != "r" || reader.GetString(1) != "p" || reader.GetBoolean(2) ||
                    reader.GetBoolean(3) || reader.GetBoolean(4) || reader.GetBoolean(5) || reader.GetBoolean(6))
                    throw Incompatible("__EFMigrationsHistory has an unreviewed kind, security policy, trigger, rule or inheritance");
            }
        }
        if (!exists) return false;

        var columns = new Dictionary<string, string>(StringComparer.Ordinal);
        await using (var query = Query(db, """
            SELECT a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,
                   a.attidentity::text,a.attgenerated::text,d.oid IS NOT NULL,ns.nspname,coll.collname
            FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
            JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
            LEFT JOIN pg_catalog.pg_collation coll ON coll.oid=a.attcollation
            LEFT JOIN pg_catalog.pg_namespace ns ON ns.oid=coll.collnamespace
            WHERE n.nspname='public' AND c.relname='__EFMigrationsHistory' AND a.attnum>0 AND NOT a.attisdropped
            """))
        {
            await using var reader = await query.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                columns.Add(reader.GetString(0), reader.GetString(1));
                if (!reader.GetBoolean(2) || reader.GetString(3) != "" || reader.GetString(4) != "" || reader.GetBoolean(5) ||
                    reader.IsDBNull(6) || reader.GetString(6) != "pg_catalog" || reader.GetString(7) != "default")
                    throw Incompatible("__EFMigrationsHistory columns have unreviewed nullability, generation, defaults or collation");
            }
        }
        if (columns.Count != 2 || columns.GetValueOrDefault("MigrationId") != "character varying(150)" ||
            columns.GetValueOrDefault("ProductVersion") != "character varying(32)")
            throw Incompatible("__EFMigrationsHistory has an unreviewed column set or types");

        var constraints = 0;
        await using (var query = Query(db, """
            SELECT k.contype::text,k.convalidated,k.condeferrable,k.condeferred,
                   ARRAY(SELECT a.attname::text FROM pg_catalog.unnest(k.conkey) WITH ORDINALITY x(num,ord)
                         JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.num ORDER BY ord)
            FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
            JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relname='__EFMigrationsHistory'
            """))
        {
            await using var reader = await query.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                constraints++;
                if (reader.GetString(0) != "p" || !reader.GetBoolean(1) || reader.GetBoolean(2) || reader.GetBoolean(3) ||
                    !reader.GetFieldValue<string[]>(4).SequenceEqual(new[] { "MigrationId" }))
                    throw Incompatible("__EFMigrationsHistory has an unreviewed constraint");
            }
        }
        if (constraints != 1) throw Incompatible("__EFMigrationsHistory requires its single reviewed primary key");

        var indexes = 0;
        await using (var query = Query(db, """
            SELECT i.indisprimary,i.indisunique,i.indisvalid,i.indisready,i.indpred IS NULL,i.indexprs IS NULL,
                   i.indnkeyatts=1 AND i.indnatts=1,am.amname,i.indnullsnotdistinct,
                   ARRAY(SELECT option FROM pg_catalog.unnest(i.indoption) option),
                   NOT EXISTS(SELECT 1 FROM pg_catalog.unnest(i.indclass) x(opclass)
                              JOIN pg_catalog.pg_opclass op ON op.oid=x.opclass
                              JOIN pg_catalog.pg_namespace ns ON ns.oid=op.opcnamespace
                              WHERE NOT op.opcdefault OR ns.nspname<>'pg_catalog'),
                   i.indcollation[0]=(SELECT a.attcollation FROM pg_catalog.pg_attribute a
                                       WHERE a.attrelid=c.oid AND a.attname='MigrationId')
            FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
            JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid JOIN pg_catalog.pg_am am ON am.oid=ix.relam
            WHERE n.nspname='public' AND c.relname='__EFMigrationsHistory'
            """))
        {
            await using var reader = await query.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                indexes++;
                if (Enumerable.Range(0, 7).Any(i => !reader.GetBoolean(i)) || reader.GetString(7) != "btree" ||
                    reader.GetBoolean(8) || reader.GetFieldValue<short[]>(9).Any(option => option != 0) ||
                    !reader.GetBoolean(10) || !reader.GetBoolean(11))
                    throw Incompatible("__EFMigrationsHistory has an unreviewed index definition");
            }
        }
        if (indexes != 1) throw Incompatible("__EFMigrationsHistory requires its single reviewed primary-key index");
        return true;
    }

    private static async Task<bool> Flag(DbContext db, string sql, CancellationToken cancellationToken)
    {
        await using var query = Query(db, sql);
        return (bool)(await query.ExecuteScalarAsync(cancellationToken))!;
    }

    private static DbCommand Query(DbContext db, string sql)
    {
        var query = db.Database.GetDbConnection().CreateCommand();
        query.CommandText = sql;
        query.CommandTimeout = db.Database.GetCommandTimeout() ?? 30;
        query.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
        return query;
    }

    private static DatabaseSchemaCompatibilityException Incompatible(string detail) => PostgreSqlSchemaCompatibility.Incompatible(detail);
}
