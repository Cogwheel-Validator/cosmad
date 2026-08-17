import { type } from "arktype";

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
  ping: "number.integer", // seconds
});

export type PagerdutyConfigType = typeof PagerdutyConfig.infer;
export type DiscordConfigType = typeof DiscordConfig.infer;
export type TelegramConfigType = typeof TelegramConfig.infer;
export type HealthCheckConfigType = typeof HealthCheckConfig.infer;
