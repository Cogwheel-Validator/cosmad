import { type } from "arktype";
import { ChainConfig } from "./chain_types";
import { CorsConfig, CsrfConfig } from "./http_types";
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
  // CORS settings for the API. Unset means any origin is allowed ("*"), which is fine when the
  // dashboard and API share an origin (e.g. both served through the same nginx host).
  "cors?": CorsConfig,
  // CSRF protection for the API. Unset means CSRF protection is disabled.
  "csrf?": CsrfConfig,

  "pagerduty?": PagerdutyConfig,
  "discord?": DiscordConfig,
  "telegram?": TelegramConfig,
  "healthCheck?": HealthCheckConfig,
  "chainConfigs?": type({ "[string]": ChainConfig }), // chainId -> ChainConfig
});

export type GlobalConfigType = typeof GlobalConfig.infer;
