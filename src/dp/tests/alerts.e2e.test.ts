import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Harness, type HarnessOptions } from "@/testing/harness";

// End-to-end alerting scenarios. Each test gets its own contained environment (see Harness):
// a fake chain served over real HTTP, the real chain worker, the real engine + DuckDB in a temp
// dir, and a local sink capturing every Telegram/Discord/PagerDuty notification.
//
// Remember the CometBFT rule the fake chain enforces: the tip's commit is never canonical, so
// a block is only ingested once the NEXT block exists. Tests produce one extra block whenever
// they need the previous ones to be visible to cosmad.

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let h: Harness;

async function env(opts: HarnessOptions = {}): Promise<Harness> {
  h = new Harness(opts);
  await h.setup();
  return h;
}

afterEach(async () => {
  await h?.teardown();
});

/** Discord copy of every notification, in order (all three channels get the same text). */
function notifications(): string[] {
  return h.sink.messages("discord");
}

function opened(type: string): string[] {
  return notifications().filter((m) => m.includes(`Alert opened: ${type}`));
}

function closed(type: string): string[] {
  return notifications().filter((m) => m.includes(`Alert closed: ${type}`));
}

describe("startup", () => {
  beforeEach(async () => {
    await env();
  });

  test("a fresh start against a healthy chain raises no alerts (in particular no 'stalled')", async () => {
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(3);

    expect(notifications()).toEqual([]);
    expect(await h.openAlertTypes()).toEqual([]);
  });

  test("a fresh start seeds from the latest settled block, then follows the chain", async () => {
    h.chain.produce(50);
    await h.startWorker();
    await h.waitForPolls(2);

    // No history backfill: only the newest canonical block (the tip itself is still finalizing).
    expect(await h.storedBlocks()).toEqual([[49, 1]]);

    h.chain.produce(3);
    await h.waitForPolls(2);
    expect(await h.storedBlocks()).toEqual([
      [49, 1],
      [50, 1],
      [51, 1],
      [52, 1],
    ]);
    expect(notifications()).toEqual([]);
  });

  test("a restart after downtime fills the gap and raises no alerts", async () => {
    h.chain.produce(10);
    await h.startWorker();
    await h.waitForPolls(2);
    await h.stopWorker();

    h.chain.produce(30);
    await h.startWorker();
    await h.waitForPolls(3);

    const heights = (await h.storedBlocks()).map(([height]) => height);
    expect(heights).toEqual(Array.from({ length: 31 }, (_, i) => 9 + i)); // 9..39, contiguous
    expect(notifications()).toEqual([]);
  });
});

describe("restart", () => {
  test("a restart with an already-open alert does not re-send the 'opened' notification", async () => {
    await env({
      alertConfig: {
        percentageMissedBlocksAlert: { enabled: false, threshold: 50, repeat: false },
      },
    });
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    h.chain.produce(4, { signed: false });
    await h.waitForPolls(2);
    expect(opened("consecutive_miss")).toHaveLength(1);

    await h.stopWorker();
    await h.startWorker();
    await h.waitForPolls(3);

    expect(opened("consecutive_miss")).toHaveLength(1);
    expect(await h.openAlertTypes()).toEqual(["consecutive_miss"]);
  });
});

describe("validator node down (stops signing)", () => {
  test("consecutive misses open an alert on every channel, and signing again closes it", async () => {
    await env({
      alertConfig: {
        percentageMissedBlocksAlert: { enabled: false, threshold: 50, repeat: false },
      },
    });
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    // Two misses: below the threshold of 3.
    h.chain.produce(3, { signed: false });
    await h.waitForPolls(2);
    expect(notifications()).toEqual([]);

    // Third miss lands.
    h.chain.produce(1, { signed: false });
    await h.waitForPolls(2);
    expect(await h.openAlertTypes()).toEqual(["consecutive_miss"]);
    expect(opened("consecutive_miss")).toHaveLength(1);
    expect(opened("consecutive_miss")[0]).toContain("3 consecutive misses (threshold 3)");

    // Same notification went out on all three channels.
    expect(h.sink.messages("telegram")).toEqual(notifications());
    expect(h.sink.messages("pagerduty")).toEqual(notifications().map((m) => `trigger: ${m}`));

    // Node comes back.
    h.chain.produce(2);
    await h.waitForPolls(2);
    expect(await h.openAlertTypes()).toEqual([]);
    expect(closed("consecutive_miss")).toHaveLength(1);
    expect(h.sink.messages("pagerduty").at(-1)).toMatch(/^resolve: /);

    // Stored records reflect reality: misses are 0, not -1 (validator stayed in the active set).
    const blocks = await h.storedBlocks();
    expect(blocks.filter(([, signed]) => signed === 0).map(([height]) => height)).toEqual([
      6, 7, 8, 9,
    ]);
  });

  test("a miss is attributed via the cached active set, without per-height validator lookups", async () => {
    await env();
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    h.chain.produce(2, { signed: false }); // heights 6 and 7
    h.chain.produce(1);
    await h.waitForPolls(2);

    expect((await h.storedBlocks()).filter(([, s]) => s === 0)).toHaveLength(2);
    // No validator lookup at the missed heights (the per-poll status query is at the tip).
    const missLookups = h.chain.requests.filter((r) => /validators\/\w+@height=(6|7)$/.test(r));
    expect(missLookups).toEqual([]);
  });

  test("the miss percentage over the signing window opens and closes its own alert", async () => {
    await env({
      alertConfig: {
        signingWindowSize: 10,
        consecutiveMissAlert: { enabled: false, threshold: 3, repeat: false, repeatInterval: 0 },
        percentageMissedBlocksAlert: { enabled: true, threshold: 50, repeat: false },
      },
    });
    h.chain.produce(11);
    await h.startWorker();
    await h.waitForPolls(2);

    // Alternate miss/sign so there is never a long streak, but half of the window is missed.
    for (let i = 0; i < 6; i++) {
      h.chain.produce(1, { signed: false });
      h.chain.produce(1, { signed: true });
    }
    h.chain.produce(1);
    await h.waitForPolls(3);
    expect(await h.openAlertTypes()).toEqual(["percentage_miss"]);
    expect(opened("percentage_miss")).toHaveLength(1);
    expect(opened("percentage_miss")[0]).toMatch(/50\.00% missed over the last 10 blocks/);

    h.chain.produce(10);
    await h.waitForPolls(3);
    expect(await h.openAlertTypes()).toEqual([]);
    expect(closed("percentage_miss")).toHaveLength(1);
  });

  test("with repeat enabled, a still-breached consecutive-miss alert re-notifies", async () => {
    await env({
      alertConfig: {
        consecutiveMissAlert: { enabled: true, threshold: 3, repeat: true, repeatInterval: 0 },
        percentageMissedBlocksAlert: { enabled: false, threshold: 50, repeat: false },
      },
    });
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    h.chain.produce(4, { signed: false });
    await h.waitForPolls(3);

    expect(opened("consecutive_miss")).toHaveLength(1);
    expect(notifications().some((m) => m.includes("Alert still open (repeat #1)"))).toBe(true);
    const [alert] = await h.openAlerts();
    expect(alert?.repeatCount).toBeGreaterThanOrEqual(1);
  });
});

describe("validator leaves the active set", () => {
  test("jailed: 'jailed' opens with the jail end, blocks are not-in-set (-1), unjail closes it", async () => {
    await env({
      alertConfig: {
        percentageMissedBlocksAlert: { enabled: false, threshold: 50, repeat: false },
      },
    });
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    // Downtime first (the usual reason for a jail)...
    h.chain.produce(4, { signed: false });
    await h.waitForPolls(2);
    expect(await h.openAlertTypes()).toEqual(["consecutive_miss"]);

    // ...then the chain jails the validator.
    h.chain.jail();
    h.chain.produce(5);
    await h.waitForPolls(3);

    expect(await h.openAlertTypes()).toEqual(["jailed"]);
    expect(opened("jailed")).toHaveLength(1);
    expect(opened("jailed")[0]).toMatch(/validator jailed until \d{4}-/);
    expect(opened("inactive")).toHaveLength(0);
    // While jailed, blocks are not misses - the validator simply isn't in the set.
    const blocks = await h.storedBlocks();
    expect(blocks.filter(([height]) => height >= 10 && height <= 13)).toEqual([
      [10, -1],
      [11, -1],
      [12, -1],
      [13, -1],
    ]);
    // The inactivity period is recorded at the height where it was observed.
    const [period] = await h.inactivity();
    expect(period).toMatchObject({ height: 14n, jailed: true, permanent: false });
    expect(period?.jailedUntil).toBeInstanceOf(Date);
    expect(period?.endHeight).toBeUndefined();

    h.chain.unjail();
    h.chain.produce(3);
    await h.waitForPolls(3);
    expect(await h.openAlertTypes()).toEqual([]);
    expect(closed("jailed")).toHaveLength(1);
    const periods = await h.inactivity();
    expect(periods).toHaveLength(1);
    expect(periods[0]?.endHeight).toBe(17n);
  });

  test("tombstoned: 'tombstoned' opens and never closes, recorded as permanent", async () => {
    await env();
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    h.chain.tombstone();
    h.chain.produce(10);
    await h.waitForPolls(3);
    h.chain.produce(10);
    await h.waitForPolls(3);

    expect(await h.openAlertTypes()).toEqual(["tombstoned"]);
    expect(opened("tombstoned")).toHaveLength(1);
    expect(opened("tombstoned")[0]).toContain("permanently jailed");
    expect(closed("tombstoned")).toHaveLength(0);
    expect(opened("jailed")).toHaveLength(0);
    expect(opened("consecutive_miss")).toHaveLength(0);
    expect(opened("percentage_miss")).toHaveLength(0);
    const periods = await h.inactivity();
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ jailed: true, permanent: true });
  });

  test("jailed, then tombstoned while still jailed: the alert and the recorded reason switch", async () => {
    await env();
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    h.chain.jail();
    h.chain.produce(3);
    await h.waitForPolls(3);
    expect(await h.openAlertTypes()).toEqual(["jailed"]);

    // Double-sign evidence lands later.
    h.chain.tombstone();
    h.chain.produce(3);
    await h.waitForPolls(3);
    expect(await h.openAlertTypes()).toEqual(["tombstoned"]);
    expect(closed("jailed")).toHaveLength(1);

    const periods = await h.inactivity();
    expect(periods.map((p) => [p.jailed, p.permanent, p.endHeight != null])).toEqual([
      [true, false, true], // the jail period ended where the tombstone was observed
      [true, true, false],
    ]);
    expect(periods[0]?.endHeight).toBe(periods[1]?.height);
  });

  test("dropped out of the active set without a jail: 'inactive' opens, rejoining closes it", async () => {
    await env();
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    h.chain.dropFromActiveSet();
    h.chain.produce(6);
    await h.waitForPolls(3);
    expect(await h.openAlertTypes()).toEqual(["inactive"]);
    expect(opened("inactive")[0]).toContain("not jailed, but outside the active set");
    expect(opened("consecutive_miss")).toHaveLength(0);
    expect(opened("jailed")).toHaveLength(0);
    expect((await h.inactivity())[0]).toMatchObject({
      jailed: false,
      permanent: false,
      bondStatus: "BOND_STATUS_UNBONDED",
    });

    h.chain.joinActiveSet();
    h.chain.produce(3);
    await h.waitForPolls(3);
    expect(await h.openAlertTypes()).toEqual([]);
    expect(closed("inactive")).toHaveLength(1);
    expect(opened("consecutive_miss")).toHaveLength(0);
    expect((await h.inactivity())[0]?.endHeight).toBeDefined();
  });

  test("starting cosmad while already jailed opens 'jailed' and records no misses", async () => {
    await env();
    h.chain.produce(5);
    h.chain.jail();
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);
    h.chain.produce(5);
    await h.waitForPolls(3);

    expect(await h.openAlertTypes()).toEqual(["jailed"]);
    expect((await h.storedBlocks()).every(([, signed]) => signed === -1)).toBe(true);
    expect(await h.inactivity()).toHaveLength(1);
  });

  test("a restart while jailed neither re-alerts nor records a second period", async () => {
    await env();
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);
    h.chain.jail();
    h.chain.produce(3);
    await h.waitForPolls(3);

    await h.stopWorker();
    h.chain.produce(3);
    await h.startWorker();
    await h.waitForPolls(3);

    expect(opened("jailed")).toHaveLength(1);
    expect(await h.inactivity()).toHaveLength(1);
  });

  test("with alertIfInactive disabled, a jail raises nothing but is still recorded", async () => {
    await env({ alertConfig: { alertIfInactive: false } });
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    h.chain.jail();
    h.chain.produce(6);
    await h.waitForPolls(3);
    expect(notifications()).toEqual([]);
    expect(await h.inactivity()).toHaveLength(1);
  });
});

describe("chain halt", () => {
  test("no new blocks for longer than stalledThreshold opens 'stalled', new blocks close it", async () => {
    await env({ alertConfig: { stalledAlert: { enabled: true, stalledThreshold: 2 } } });
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(3);
    expect(notifications()).toEqual([]);

    // Halt: nothing is produced. Wait past the threshold.
    await new Promise((r) => setTimeout(r, 2_500));
    await h.waitForPolls(2);
    expect(await h.openAlertTypes()).toEqual(["stalled"]);
    expect(opened("stalled")).toHaveLength(1);
    expect(opened("stalled")[0]).toContain("no new block seen in over 2s");

    // Chain resumes.
    h.chain.produce(2);
    await h.waitForPolls(2);
    expect(await h.openAlertTypes()).toEqual([]);
    expect(closed("stalled")).toHaveLength(1);
  });
});

describe("infrastructure failures", () => {
  test("all RPCs down: one rpc_down per endpoint, then closed and caught up on recovery", async () => {
    await env({ rpcNodes: 2 });
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    h.chain.rpcDown = true;
    h.chain.produce(5);
    await h.waitForPolls(2);
    expect(await h.openAlertTypes()).toEqual(["rpc_down", "rpc_down"]);
    expect(opened("rpc_down")).toHaveLength(2);
    for (const url of h.chain.rpcUrls) {
      expect(opened("rpc_down").some((m) => m.includes(`rpc_down ${url} (unreachable`))).toBe(true);
    }
    expect((await h.openAlerts()).map((a) => a.subject).sort()).toEqual(
      [...h.chain.rpcUrls].sort(),
    );

    h.chain.rpcDown = false;
    h.chain.produce(1);
    await h.waitForPolls(3);
    expect(await h.openAlertTypes()).toEqual([]);
    expect(closed("rpc_down")).toHaveLength(2);
    const heights = (await h.storedBlocks()).map(([height]) => height);
    expect(heights).toEqual([4, 5, 6, 7, 8, 9, 10]);
    // No collateral alerts from the outage (e.g. stalled or misses).
    expect(notifications().filter((m) => !m.includes("rpc_down"))).toEqual([]);
  });

  test("one of two RPCs down: alert for that endpoint only, ingestion continues on the other", async () => {
    await env({ rpcNodes: 2 });
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    h.chain.downRpcNodes.add(1);
    h.chain.produce(4);
    await h.waitForPolls(3);
    expect(opened("rpc_down")).toEqual([
      expect.stringContaining(`rpc_down ${h.chain.rpcUrls[1]} (unreachable`),
    ]);
    expect(Math.max(...(await h.storedBlocks()).map(([height]) => height))).toBe(8);

    h.chain.downRpcNodes.delete(1);
    await h.waitForPolls(3);
    expect(await h.openAlertTypes()).toEqual([]);
    expect(closed("rpc_down")).toHaveLength(1);
  });

  test("an RPC that is reachable but catching up is reported as down, with the reason", async () => {
    await env({ rpcNodes: 2 });
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    h.chain.catchingUpRpcNodes.add(0);
    await h.waitForPolls(3);
    expect(opened("rpc_down")).toEqual([
      expect.stringContaining(`rpc_down ${h.chain.rpcUrls[0]} (node is catching up)`),
    ]);
  });

  test("an endpoint without alertIfDown never alerts", async () => {
    await env({ rpcNodes: 2, rpcAlertIfDown: [true, false] });
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    h.chain.downRpcNodes.add(1);
    await h.waitForPolls(3);
    expect(notifications()).toEqual([]);
  });

  test("REST API down: api_down opens, blocks are still ingested, misses still alert", async () => {
    await env({
      alertConfig: {
        percentageMissedBlocksAlert: { enabled: false, threshold: 50, repeat: false },
      },
    });
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    h.chain.apiDown = true;
    h.chain.produce(4, { signed: false });
    await h.waitForPolls(2);
    expect(await h.openAlertTypes()).toEqual(["api_down", "consecutive_miss"]);
    expect(opened("api_down")[0]).toContain(`api_down ${h.chain.apiUrl}`);
    expect(opened("inactive")).toHaveLength(0);

    h.chain.apiDown = false;
    await h.waitForPolls(3);
    expect(closed("api_down")).toHaveLength(1);
  });

  test("REST API down while jailed: the status is unknown, so 'jailed' stays open", async () => {
    await env();
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);
    h.chain.jail();
    h.chain.produce(3);
    await h.waitForPolls(3);
    expect(await h.openAlertTypes()).toEqual(["jailed"]);

    h.chain.apiDown = true;
    h.chain.produce(2);
    await h.waitForPolls(2);
    expect(await h.openAlertTypes()).toEqual(["api_down", "jailed"]);
    expect(closed("jailed")).toHaveLength(0);
  });

  test("a notifier that fails transiently is retried and the alert is still delivered", async () => {
    await env({
      alertConfig: {
        percentageMissedBlocksAlert: { enabled: false, threshold: 50, repeat: false },
      },
    });
    h.chain.produce(5);
    await h.startWorker();
    await h.waitForPolls(2);

    h.sink.failNext = 2;
    h.chain.produce(4, { signed: false });
    await h.waitForPolls(2);

    expect(h.sink.messages("discord").length).toBe(1);
    expect(h.sink.messages("telegram").length).toBe(1);
    expect(h.sink.messages("pagerduty").length).toBe(1);
  });
});
