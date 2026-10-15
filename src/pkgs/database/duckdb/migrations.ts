export interface Migration {
  /** Strictly increasing integer. The database stores the highest applied version. */
  version: number;
  /** Statements run in order inside one transaction. */
  sql: string[];
}

/**
 * Ordered schema migrations, applied to existing databases whose recorded version is lower.
 * Fresh databases skip these (the generated schema is already current) and are stamped with
 * the latest version. Add new entries at the end with the next version number.
 */
export const migrations: Migration[] = [
  {
    version: 0.1,
    sql: [],
  },
];

export const latestMigrationVersion = migrations.reduce((max, m) => Math.max(max, m.version), 0);
