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
});
