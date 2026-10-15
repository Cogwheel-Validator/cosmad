import { type } from "arktype";

const UNIT_MS = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
} as const;

const SEGMENT = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)/y;
const EXPECTED = 'a duration such as "30s", "2m", "1h30m" or "120000ms"';

/**
 * Parses a duration string into milliseconds. Units: ms, s, m, h, d, w. Several parts can be
 * chained ("1h30m", "1m 30s") and numbers may have decimals ("1.5s"). Returns undefined if the
 * string is not a duration. A bare number without a unit is not a duration string.
 */
export function parseDuration(input: string): number | undefined {
  const text = input.trim().toLowerCase();
  if (text === "") return undefined;
  let total = 0;
  let pos = 0;
  while (pos < text.length) {
    SEGMENT.lastIndex = pos;
    const match = SEGMENT.exec(text);
    if (!match) return undefined;
    total += Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
    pos = SEGMENT.lastIndex;
    while (text[pos] === " ") pos++;
  }
  return Math.round(total);
}

/**
 * A duration config value: a string with a unit ("90s", "5m", "1h30m") or, for backwards
 * compatibility, a bare number in `bareUnit`. Parsed to a number of `outUnit`.
 * Every setting keeps the unit its consumers already use, so a number written the old way still
 * means what it always meant.
 */
function durationOf(bareUnit: "s" | "ms", outUnit: "s" | "ms") {
  return type("string | number").pipe((value, ctx) => {
    const ms = typeof value === "number" ? value * UNIT_MS[bareUnit] : parseDuration(value);
    if (ms === undefined || !Number.isFinite(ms)) return ctx.error(EXPECTED);
    return ms / UNIT_MS[outUnit];
  });
}

const seconds = durationOf("s", "s");
const milliseconds = durationOf("ms", "ms");

/** Seconds (bare numbers are seconds). Value > 0. */
export const PositiveSeconds = seconds.to("number > 0");
/** Seconds (bare numbers are seconds). Value >= 0. */
export const NonNegativeSeconds = seconds.to("number >= 0");
/** Integer milliseconds (bare numbers are milliseconds). Value > 0. */
export const PositiveMilliseconds = milliseconds.to("number.integer > 0");
/** Whole seconds (bare numbers are seconds). Value >= 0. */
export const WholeSeconds = seconds.to("number.integer >= 0");
