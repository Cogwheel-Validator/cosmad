import type { DuckDbOptions } from "../pkgs/database/duckdb/rw_db";
import type { ChainConfigType } from "./chain_types";
import { ConfigLoader } from "./config_loader";
import type { CorsConfigType, CsrfConfigType } from "./http_types";
import { loadEnv } from "./env";
import type {
  DiscordConfigType,
  HealthCheckConfigType,
  PagerdutyConfigType,
  TelegramConfigType,
} from "./notification_types";

export type ChainConfig = ChainConfigType & { chainId: string };

export interface ApiConfig {
  port: number;
  host: string;
  enabled: boolean;
  dashboardEnabled: boolean;
  cors: CorsConfigType | undefined;
  csrf: CsrfConfigType | undefined;
}

export interface GlobalAlertsConfig {
  telegram: TelegramConfigType | undefined;
  discord: DiscordConfigType | undefined;
  pagerduty: PagerdutyConfigType | undefined;
  healthCheck: HealthCheckConfigType | undefined;
}

export interface CosmadConfig {
  dbDir: string;
  dbOptions: DuckDbOptions;
  api: ApiConfig;
  chains: ChainConfig[];
  globalAlerts: GlobalAlertsConfig;
  engineSocketPath: string;
}

const env = loadEnv();
const loader = new ConfigLoader(env.globalConfigPath, env.chainsDirectory);

export const config: CosmadConfig = {
  dbDir: env.dbDirectory,
  dbOptions: {
    threads: env.dbThreads,
    memoryLimit: env.dbMemLimit,
    maxTempDirectorySize: env.dbMaxTempDirSize,
  },
  api: {
    port: env.apiPort,
    host: env.apiHost,
    enabled: loader.data.apiEnabled,
    dashboardEnabled: loader.data.dashboardEnabled,
    cors: loader.data.cors,
    csrf: loader.data.csrf,
  },
  chains: [...loader.data.chainConfigs.entries()].map(([chainId, chainConfig]) => ({
    chainId,
    ...chainConfig,
  })),
  globalAlerts: loader.data.globalAlerts,
  engineSocketPath: env.engineSocketPath,
};
