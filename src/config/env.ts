import os from "node:os";

export interface CosmadEnv {
  apiPort: number;
  dbThreads: string;
  dbMemLimit: string;
  dbMaxTempDirSize: string;
  dbDirectory: string;
  globalConfigPath: string;
  chainsDirectory: string;
  engineSocketPath: string;
}

export function loadEnv(): CosmadEnv {
  const cpuCount = os.cpus().length;
  const ramMem = os.totalmem();

  let dbMemLimit: string;
  if (process.env.DB_MEM_LIMIT) {
    dbMemLimit = process.env.DB_MEM_LIMIT;
  } else {
    const ramMemInGb = ramMem / (1024 * 1024 * 1024);
    // if 20% of RAM is less than 1GB force it to use 1GB,
    // else use the 20% of RAM
    if (ramMemInGb / 5 < 1) {
      dbMemLimit = `1GB`;
    } else {
      dbMemLimit = `${ramMemInGb / 5}GB`;
    }
  }

  const dbDirectory = process.env.DB_DIRECTORY ?? "./data";

  return {
    apiPort: Number(process.env.PORT ?? 3000),
    dbThreads: process.env.DB_THREADS ?? `${cpuCount}`,
    dbMemLimit: dbMemLimit,
    dbMaxTempDirSize: process.env.DB_MAX_TEMP_DIR_SIZE ?? "1GB",
    dbDirectory: process.env.DB_DIRECTORY ?? "./data",
    globalConfigPath: process.env.GLOBAL_CONFIG_PATH ?? "./config/config.toml",
    chainsDirectory: process.env.CHAINS_DIRECTORY ?? "./config/chains",
    engineSocketPath: process.env.ENGINE_SOCKET_PATH ?? `${dbDirectory}/engine.sock`,
  };
}
