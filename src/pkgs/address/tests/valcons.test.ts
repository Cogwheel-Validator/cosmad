import { bech32 } from "bech32";
import { describe, expect, test } from "vitest";
import { bech32ValconsToHex } from "../valcons";

describe("bech32ValconsToHex", () => {
  test("encode address back to uppercase hex", () => {
    const hex = "8A948A32DC693745146C2CD913815B166675809B";
    const bytes = Buffer.from(hex, "hex");
    const encoded = bech32.encode("cosmosvalcons", bech32.toWords(bytes));

    expect(bech32ValconsToHex(encoded)).toBe(hex);
  });

  test("HRP-agnostic", () => {
    const bytes = Buffer.from(Array.from({ length: 20 }, (_, i) => i * 7 + 3));
    const hex = bytes.toString("hex").toUpperCase();
    const encoded = bech32.encode("atonevalcons", bech32.toWords(bytes));

    expect(bech32ValconsToHex(encoded)).toBe(hex);
  });
});
