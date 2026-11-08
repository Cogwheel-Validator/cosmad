import { type } from "arktype";
import { PositiveSeconds } from "./duration";

export const PagerdutyConfig = type({
  enabled: "boolean",
  serviceKey: "string",
});

export const DiscordConfig = type({
  enabled: "boolean",
  webhookUrl: "string.url",
});

export const TelegramConfig = type({
  enabled: "boolean",
  botToken: "string",
  chatId: "string",
});

export const HealthCheckConfig = type({
  enabled: "boolean",
  endpoint: "string.url",
  ping: PositiveSeconds, // e.g. "1m"; a bare number is seconds
});

export type PagerdutyConfigType = typeof PagerdutyConfig.infer;
export type DiscordConfigType = typeof DiscordConfig.infer;
export type TelegramConfigType = typeof TelegramConfig.infer;
export type HealthCheckConfigType = typeof HealthCheckConfig.infer;
