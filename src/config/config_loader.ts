import type { ChainConfigType } from "./chain_types";
import { loadChainConfigs, loadGlobalConfig } from "./config";
import type {
  DiscordConfigType,
  HealthCheckConfigType,
  PagerdutyConfigType,
  TelegramConfigType,
} from "./notification_types";

export interface ConfigLoaderData {
  apiEnabled: boolean;
  dashboardEnabled: boolean;
  chainConfigs: Map<string, ChainConfigType>;
  globalAlerts: {
    telegram: TelegramConfigType | undefined;
    discord: DiscordConfigType | undefined;
    pagerduty: PagerdutyConfigType | undefined;
    healthCheck: HealthCheckConfigType | undefined;
  };
}

export class ConfigLoader {
  data!: ConfigLoaderData;
  constructor(globalConfigPath: string, chainsDir: string) {
    const globalConfig = loadGlobalConfig(globalConfigPath);
    const chainConfigs = loadChainConfigs(chainsDir);
    if (globalConfig.ok && chainConfigs.ok) {
      this.data = {
        apiEnabled: globalConfig.value.serveApi,
        dashboardEnabled: globalConfig.value.serveDashboard,
        chainConfigs: chainConfigs.value,
        globalAlerts: {
          telegram: globalConfig.value.telegram,
          discord: globalConfig.value.discord,
          pagerduty: globalConfig.value.pagerduty,
          healthCheck: globalConfig.value.healthCheck,
        },
      };
      // Seems typescript is not smart enough to narrow the type here
    } else if (!globalConfig.ok) {
      throw globalConfig.error;
    } else if (!chainConfigs.ok) {
      throw chainConfigs.error;
    }
  }
}
