import { ArkErrors } from "arktype";
import { describe, expect, test } from "vitest";
import { PositiveMilliseconds, PositiveSeconds, parseDuration } from "../duration";

describe("parseDuration", () => {
  test.each([
    ["120000ms", 120_000],
    ["120s", 120_000],
    ["2m", 120_000],
    ["1h", 3_600_000],
    ["1h30m", 5_400_000],
    ["1m 30s", 90_000],
    ["1.5s", 1_500],
    ["2d", 172_800_000],
    ["1w", 604_800_000],
    [" 5M ", 300_000],
  ])("%s -> %d ms", (input, ms) => {
    expect(parseDuration(input)).toBe(ms);
  });

  test.each(["", "60", "s", "1x", "1h foo", "-5s", "1..5s"])("rejects %j", (input) => {
    expect(parseDuration(input)).toBeUndefined();
  });
});

describe("duration config types", () => {
  test("seconds fields: strings are parsed, bare numbers stay seconds", () => {
    expect(PositiveSeconds("2m")).toBe(120);
    expect(PositiveSeconds(120)).toBe(120);
    expect(PositiveSeconds("1500ms")).toBe(1.5);
  });

  test("millisecond fields: strings are parsed, bare numbers stay milliseconds", () => {
    expect(PositiveMilliseconds("6s")).toBe(6_000);
    expect(PositiveMilliseconds(6_000)).toBe(6_000);
  });

  test("invalid values are rejected with a helpful message", () => {
    const bad = PositiveSeconds("soon");
    expect(bad).toBeInstanceOf(ArkErrors);
    expect(String(bad)).toContain('"30s"');
    expect(PositiveSeconds("0s")).toBeInstanceOf(ArkErrors);
    expect(PositiveSeconds("60")).toBeInstanceOf(ArkErrors);
  });
});
