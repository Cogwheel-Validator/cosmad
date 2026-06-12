import { type } from "arktype";
import { ChainConfig } from "./chain_types";
import { DiscordConfig, PagerdutyConfig, TelegramConfig } from "./notification_types";

export { DiscordConfig, PagerdutyConfig, TelegramConfig };

const HealthCheckConfig = type({
  enabled: "boolean",
  endpoint: "string.url",
  ping: "number.integer", // seconds
});

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
