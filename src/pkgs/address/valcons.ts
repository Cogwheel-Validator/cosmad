import { bech32 } from "bech32";

/**
 * Converts a bech32-encoded consensus address (e.g. `cosmosvalcons1...`) into the raw
 * uppercase hex form used by RPC commit signatures HRP-agnostic, it should works for
 * any chain's `valcons` bech32 prefix.
 * @param valconsAddress The bech32-encoded consensus address to convert.
 * @returns The raw uppercase hex form of the consensus address.
 */
export function bech32ValconsToHex(valconsAddress: string): string {
  const { words } = bech32.decode(valconsAddress);
  const bytes = bech32.fromWords(words);
  return Buffer.from(bytes).toString("hex").toUpperCase();
}
