import { type } from "arktype";
import { ChainConfig } from "./chain_types";

export const PagerdutyConfig = type({
  enabled: "boolean",
  serviceKey: "string",
});

export const DiscordConfig = type({
  enabled: "boolean",
  webhookUrl: "string",
});

export const TelegramConfig = type({
  enabled: "boolean",
  apiToken: "string",
})

const HealthCheckConfig = type({
  enabled: "boolean",
  endpoint: "string",
  ping: "number", // seconds
});

export const GlobalConfig = type({
  serveApi: "boolean",
  // For the dashboard to work the API needs to be served.
  serveDashboard: "boolean",

  pagerduty: PagerdutyConfig.or(type.undefined),
  discord: DiscordConfig.or(type.undefined),
  telegram: TelegramConfig.or(type.undefined),
  healthCheck: HealthCheckConfig.or(type.undefined),
  chainConfigs: ChainConfig.array().or(type.undefined),
});
