# Migrations

Docs for any migrations in the past and in the future releases.

## DuckDB 1.5 to 2.0 (before the first official release)

COSMAD now runs on DuckDB 2.0 (`@duckdb/node-api` 2.0.x). It stays on 2.0 from here on.

If you ran COSMAD from source before this change, your database file was created by DuckDB 1.x.
DuckDB 2.0 can still open it and keeps it in the old storage format, so nothing breaks, but the
file is not on the v2 format. Pick one of the options below.

### Option 1: start fresh

If the data is disposable (development or testing), stop COSMAD, delete `cosmad.duckdb`
(and `cosmad.duckdb.wal` if present) in the data directory, and start again. COSMAD recreates
the schema in the v2 format.

### Option 2: convert the existing file

Use a DuckDB 1.5 CLI to export and a 2.0 CLI to import. Stop COSMAD first and back up the file.

```bash
cp cosmad.duckdb cosmad.duckdb.bak

# with a 1.5 duckdb binary
duckdb cosmad.duckdb -c "EXPORT DATABASE 'cosmad_export'"

# with a 2.0 duckdb binary, into a new file
duckdb cosmad_v2.duckdb -c "IMPORT DATABASE 'cosmad_export'"

mv cosmad_v2.duckdb cosmad.duckdb
```

### Gotchas

- **One-way format.** A file written in the v2 format cannot be opened by DuckDB
  1.x. Debug with a 2.0 CLI, and do not point an older COSMAD build at a v2 database.
- **Single writer.** Only one process may open the database read-write, same as
  before.
- **Transactions.** In DuckDB 2.0, an error inside an explicit transaction invalidates it and it must
  be rolled back. Keep this in mind when writing new transactional code.
- **SQL changes.** DuckDB 2.0 uses a new default parser. Regex `~` now matches partially, integer
  `//` and `%` by zero raise an error, and an untyped `NULL` in `CREATE TABLE AS` keeps type `NULL`.
  See the [DuckDB migration guide](https://duckdb.org/docs/2.0/operations_manual/migration.html).

## Schema changes

The schema evolves with additive column migrations that run automatically on start.
See [How it works](architecture.md).
