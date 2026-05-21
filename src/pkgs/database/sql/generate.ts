import { type ColumnOptions, type Constructor, columnRegistry, tableRegistry } from "./types";
import { AllowedTypes } from "./types";


export function generateCreateTable(target: Constructor): string {
  const tableName = tableRegistry.get(target);
  const columns = columnRegistry.get(target) ?? [];

  if (!tableName) throw new Error(`No @Table decorator on ${target.name}`);

  const countPrimKeys = columns.filter((col) => col.primary).length;

  const columnDefs = columns.map((col: ColumnOptions) => {
    let def = `${col.name} ${col.type}`;
    if (col.type == AllowedTypes.VARCHAR) def += `(${col.varcharLen})`;
    if (!col.nullable) def += " NOT NULL";
    if (col.default) def += ` DEFAULT ${col.default}`;
    if (col.primary && countPrimKeys === 1) def += " PRIMARY KEY";
    if (col.unique) def += " UNIQUE";
    return def;
  });

  const indexes = columns
    .filter((col) => col.index && !col.primary)
    .map(
      (col) =>
        `CREATE INDEX IF NOT EXISTS idx_${tableName}_${col.propertyKey} ON ${tableName}(${col.propertyKey});`,
    );

  const primKeyStr = () => {
    if (countPrimKeys > 1) {
      const keys = columns.filter((col) => col.primary).map((col) => col.propertyKey).join(", ");
      return ` PRIMARY KEY (${keys})`;
    } else return ""
  }

  return [
    `CREATE TABLE IF NOT EXISTS ${tableName} (`,
    `  ${columnDefs.join(",\n  ")}`,
    `) ${primKeyStr()} ;`,
    ...indexes,
  ].join("\n");
}
