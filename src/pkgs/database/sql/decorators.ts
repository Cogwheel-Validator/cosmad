import { type ColumnOptions, type Constructor, columnRegistry, tableRegistry } from "./types";

export function Table(tableName: string) {
  // biome-ignore lint/complexity/noBannedTypes: <It has to be done like this to wrap it arround class.>
  return (target: Function,) => {
    tableRegistry.set(target as Constructor, tableName);
  };
}

export function Column(options: ColumnOptions) {
  return (target: object, propertyKey: string | symbol) => {
    const ConstructorClass = target.constructor as Constructor;
    const existing = columnRegistry.get(ConstructorClass) ?? [];
    columnRegistry.set(ConstructorClass, [
      ...existing,
      { ...options, propertyKey: String(propertyKey) },
    ]);
  };
}
