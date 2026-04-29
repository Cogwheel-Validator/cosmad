import { type ColumnOptions, type Constructor, columnRegistry, tableRegistry } from "./types";

export function generateCreateTable(target: Constructor): string {
  const tableName = tableRegistry.get(target);
  const columns = columnRegistry.get(target) ?? [];

  if (!tableName) throw new Error(`No @Table decorator on ${target.name}`);

  const columnDefs = columns.map((col: ColumnOptions) => {
    let def = `${col.propertyKey} ${col.type}`;
    if (!col.nullable) def += " NOT NULL";
    if (col.default) def += ` DEFAULT ${col.default}`;
    if (col.primary) def += " PRIMARY KEY";
    return def;
  });

  const indexes = columns
    .filter((col) => col.index && !col.primary)
    .map(
      (col) =>
        `CREATE INDEX IF NOT EXISTS idx_${tableName}_${col.propertyKey} ON ${tableName}(${col.propertyKey});`,
    );

  return [
    `CREATE TABLE IF NOT EXISTS ${tableName} (`,
    `  ${columnDefs.join(",\n  ")}`,
    `);`,
    ...indexes,
  ].join("\n");
}
