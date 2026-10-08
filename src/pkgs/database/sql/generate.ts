import {
  AllowedTypes,
  type ColumnOptions,
  type Constructor,
  columnRegistry,
  tableRegistry,
} from "./types";

export function generateCreateTable(target: Constructor): string {
  return generateCreateTableStatements(target).join("\n");
}

/**
 * Returns each DDL statement for the given table as a separate string so they
 * can be executed one at a time. Every statement uses IF NOT EXISTS, making
 * the full set idempotent and safe to run on every startup.
 */
export function generateCreateTableStatements(target: Constructor): string[] {
  const tableName = tableRegistry.get(target);
  const columns = columnRegistry.get(target) ?? [];

  if (!tableName) throw new Error(`No @Table decorator on ${target.name}`);

  const countPrimKeys = columns.filter((col) => col.primary).length;

  const columnDefs = columns.map((col: ColumnOptions) => {
    let def = `${col.name} ${col.type}`;
    if (col.type === AllowedTypes.VARCHAR) def += `(${col.varcharLen})`;
    if (!col.nullable) def += " NOT NULL";
    if (col.default) def += ` DEFAULT ${col.default}`;
    if (col.primary && countPrimKeys === 1) def += " PRIMARY KEY";
    if (col.unique) def += " UNIQUE";
    return def;
  });

  const primKeys =
    countPrimKeys > 1
      ? `, PRIMARY KEY (${columns
          .filter((col) => col.primary)
          .map((col) => col.name)
          .join(", ")})`
      : "";

  const tableStmt = [
    `CREATE TABLE IF NOT EXISTS ${tableName} (`,
    `  ${columnDefs.join(",\n  ")}${primKeys}`,
    `)`,
  ].join("\n");

  const indexStmts = columns
    .filter((col) => col.index && !col.primary)
    .map(
      (col) =>
        `CREATE INDEX IF NOT EXISTS idx_${tableName}_${col.propertyKey} ON ${tableName}(${col.name})`,
    );

  // Additive schema evolution for databases created by an older version: a column added later
  // to the class is added to the existing table too. Only possible for columns an existing row
  // can satisfy (nullable or defaulted) - NOT NULL columns without a default must exist from
  // the start. Idempotent like everything above.
  const addColumnStmts = columns
    .filter((col) => !col.primary && (col.nullable || col.default != null))
    .map((col) => {
      let def = `${col.name} ${col.type}`;
      if (col.type === AllowedTypes.VARCHAR) def += `(${col.varcharLen})`;
      if (col.default) def += ` DEFAULT ${col.default}`;
      return `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${def}`;
    });

  return [tableStmt, ...addColumnStmts, ...indexStmts];
}
