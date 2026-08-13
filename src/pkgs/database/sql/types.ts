export enum AllowedTypes {
  BOOLEAN = "BOOLEAN",
  BIGINT = "INT8",
  BYTEA = "BYTEA",
  DOUBLE = "DOUBLE",
  INTEGER = "INT4",
  JSON = "JSON",
  TEXT = "TEXT",
  TINYINT = "INT1",
  TIMESTAMP = "TIMESTAMP",
  UBIGINT = "UINT8",
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
