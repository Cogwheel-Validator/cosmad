import { type ColumnOptions, type Constructor, columnRegistry, tableRegistry } from "./types";

export function Tables() {
  return (target: Constructor) => {
    tableRegistry.set(target, target.name);
  };
}

export function Column(options: ColumnOptions) {
  return (target: Constructor, propertyKey: string) => {
    const existing = columnRegistry.get(target) ?? [];
    columnRegistry.set(target, [...existing, { ...options, propertyKey }]);
  };
}
