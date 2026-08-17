import axios from "axios";
import { describe, expect, test, vi } from "vitest";
import { getSlashingParams } from "../query";

vi.mock("axios");

describe("getSlashingParams", () => {
  test("parses signed_blocks_window as a number from the standard slashing params response", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        params: {
          signed_blocks_window: "10000",
          min_signed_per_window: "0.050000000000000000",
          downtime_jail_duration: "600s",
          slash_fraction_double_sign: "0.050000000000000000",
          slash_fraction_downtime: "0.000100000000000000",
        },
      },
    });

    const result = await getSlashingParams("https://api.test");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.params.signedBlocksWindow).toBe(10000);
    }

    expect(axios.get).toHaveBeenCalledWith(
      "https://api.test/cosmos/slashing/v1beta1/params",
      expect.anything(),
    );
  });

  test("returns an error result when the endpoint is unreachable", async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error("network down"));

    const result = await getSlashingParams("https://api.test");
    expect(result.ok).toBe(false);
  });
});
