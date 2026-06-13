import { type } from "arktype";
import { ChainConfig } from "./chain_types";
import {
  DiscordConfig,
  HealthCheckConfig,
  PagerdutyConfig,
  TelegramConfig,
} from "./notification_types";

export const GlobalConfig = type({
  serveApi: "boolean",
  // For the dashboard to work the API needs to be served.
  serveDashboard: "boolean",

  "pagerduty?": PagerdutyConfig,
  "discord?": DiscordConfig,
  "telegram?": TelegramConfig,
  "healthCheck?": HealthCheckConfig,
  "chainConfigs?": type({ "[string]": ChainConfig }), // chainId -> ChainConfig
});

export type GlobalConfigType = typeof GlobalConfig.infer;
