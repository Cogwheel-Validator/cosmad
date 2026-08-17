import { type } from "arktype";
import { DiscordConfig, PagerdutyConfig, TelegramConfig } from "./notification_types";

const ConsecutiveMissAlert = type({
  enabled: "boolean",
  threshold: "number", // blocks
  repeat: "boolean", // repeat the alert if not resolved, default false
  repeatInterval: "number", // seconds
});

const PercentageMissAlert = type({
  enabled: "boolean",
  threshold: "0.5 < number <= 95", // percentage, minimum 0.5, max 95
  // Repeat the alert if not resolved, default false.
  // The repeat in this case will happen every time by increasing the threshold by 50%
  repeat: "boolean",
});

// Part of the ChainConfig. Used to declare configuration how and when to raise the alert.
export const AlertConfig = type({
  // Stalled alerts, when the chain doesn't produce blocks for certain amount of time.
  stalledAlert: type({
    enabled: "boolean",
    stalledThreshold: "number", // seconds
  }),

  // Consecutive missed blocks alert, when the validator misses a certain amount of blocks in a row.
  consecutiveMissAlert: ConsecutiveMissAlert,

  // Percentage of missed blocks alert, when the validator misses a certain percentage of blocks in
  // the latest sign window.
  percentageMissedBlocksAlert: PercentageMissAlert,

  // Send alert if the validator is in the inactive set, jailed or tombstoned.
  alertIfInactive: "boolean",

  // Number of trailing blocks to use as the sliding signing window for
  // percentageMissedBlocksAlert evaluation.
  // It is optional for bft chains since this is normally fetched
  // from the chain itself (signed_blocks_window via /cosmos/slashing/v1beta1/params) rather
  // than configured. You could override it for bft chains but I can't recommend this unless
  // you know what you're doing.
  // For tm2 chains (no such endpoint) it defaults to 10_000 if left unset. For tm2 it is recommended
  // to set it to some value that makes sense for your chain's block time and slashing window.
  "signingWindowSize?": "number.integer > 0",

  // Telegram alert config. If you want to overwrite the global settings, else leave it empty.
  "telegram?": TelegramConfig,

  // Pagerduty alert config. If you want to overwrite the global settings, else leave it empty.
  "pagerduty?": PagerdutyConfig,

  // Discord alert config. If you want to overwrite the global settings, else leave it empty.
  "discord?": DiscordConfig,
});
