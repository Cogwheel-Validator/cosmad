enum AllowedTypes {
  TEXT = "TEXT",
  INTEGER = "INTEGER",
  BIGINT = "BIGINT",
  DOUBLE = "DOUBLE",
  BOOLEAN = "BOOLEAN",
  TIMESTAMP = "TIMESTAMP",
  JSON = "JSON",
}

export interface ColumnOptions {
  name: string;
  type: AllowedTypes;
  primary?: boolean;
  index?: boolean;
  nullable?: boolean;
  default?: string;
  propertyKey: string;
}

export type Constructor<T = object> = new (...args: unknown[]) => T;

export const tableRegistry = new Map<Constructor, string>();
export const columnRegistry = new Map<Constructor, ColumnOptions[]>();
