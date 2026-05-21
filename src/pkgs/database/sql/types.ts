export enum AllowedTypes {
  BOOLEAN = "BOOLEAN",
  BIGINT = "BIGINT",
  BYTEA = "BYTEA",
  DOUBLE = "DOUBLE",
  INTEGER = "INTEGER",
  JSON = "JSON",
  TEXT = "TEXT",
  TINIINT = "TINIINT",
  TIMESTAMP = "TIMESTAMP",
  UBIGINT = "UBIGINT",
  VARCHAR = "VARCHAR",
}

export interface ColumnOptions {
  name: string;
  type: AllowedTypes;
  primary?: boolean;
  index?: boolean;
  nullable?: boolean;
  default?: string;
  propertyKey?: string;
  unique?: boolean;
  varcharLen?: number;
}

export type Constructor<T = object> = new (...args: unknown[]) => T;

export const tableRegistry = new Map<Constructor, string>();
export const columnRegistry = new Map<Constructor, ColumnOptions[]>();
