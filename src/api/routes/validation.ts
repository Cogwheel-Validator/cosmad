import { ArkErrors, type } from "arktype";

export const validHeight = type("string.numeric").pipe((height) => BigInt(height));

const MIN_DAYS = 1;
const MAX_DAYS = 365;
const DEFAULT_DAYS = 30;

const daysString = type("string.integer.parse").pipe((days) =>
  Math.min(Math.max(days, MIN_DAYS), MAX_DAYS),
);

/** Parses a `days` query param, defaulting to 30 and clamping to [1, 365].
 * @param raw - The raw days string to parse.
 */
export function validDays(raw: string | undefined): number {
  if (raw == null || raw === "") return DEFAULT_DAYS;
  const parsed = daysString(raw);
  return parsed instanceof ArkErrors ? DEFAULT_DAYS : parsed;
}

const MIN_LIMIT = 1;
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

const limitString = type("string.integer.parse").pipe((limit) =>
  Math.min(Math.max(limit, MIN_LIMIT), MAX_LIMIT),
);

/** Parses a `limit` query param, defaulting to 100 and clamping to [1, 500].
 * @param raw - The raw limit string to parse.
 */
export function validLimit(raw: string | undefined): number {
  if (raw == null || raw === "") return DEFAULT_LIMIT;
  const parsed = limitString(raw);
  return parsed instanceof ArkErrors ? DEFAULT_LIMIT : parsed;
}
