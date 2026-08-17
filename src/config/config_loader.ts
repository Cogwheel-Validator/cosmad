import logger from "../pkgs/logger";
import type { ChainConfigType } from "./chain_types";
import { loadChainConfigs, loadGlobalConfig } from "./config";
import type { GlobalConfigType } from "./global_config";
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

const log = logger.child({ module: "config_loader" });

export class ConfigLoader {
  data!: ConfigLoaderData;
  constructor(globalConfigPath: string, chainsDir: string) {
    const globalConfig = loadGlobalConfig(globalConfigPath);
    const chainConfigs = loadChainConfigs(chainsDir);

    const chainMap = new Map<string, ChainConfigType>();
    if (globalConfig.ok && chainConfigs.ok) {
      combineChainConfigs(globalConfig.value, chainConfigs.value, chainMap);
      this.data = {
        apiEnabled: globalConfig.value.serveApi,
        dashboardEnabled: globalConfig.value.serveDashboard,
        chainConfigs: chainMap,
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

function combineChainConfigs(
  globalConfig: GlobalConfigType,
  chainConfigs: Map<string, ChainConfigType>,
  chainMap: Map<string, ChainConfigType>,
) {
  if (globalConfig.chainConfigs) {
    for (const [chainId, config] of Object.entries(globalConfig.chainConfigs)) {
      chainMap.set(chainId, config);
    }
  }

  if (chainConfigs.size > 0) {
    for (const [chainId, config] of chainConfigs.entries()) {
      if (chainMap.has(chainId)) {
        log.warn(`Chain ${chainId} is defined in both global config and chain configs.`);
        log.info("Overwriting global config with chain config.");
      }
      chainMap.set(chainId, config);
    }
  }
}
