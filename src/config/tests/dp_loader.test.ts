import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadChainConfigs, loadGlobalConfig } from "../config";
import { ArkLoaderError, GeneralLoaderError } from "../errors";

const testDataDir = join(import.meta.dirname, "test_data");
const test1Dir = join(testDataDir, "test_1");
const test2Dir = join(testDataDir, "test_2");
const test3Dir = join(testDataDir, "test_3");
const test4Dir = join(testDataDir, "test_4");
const test5Dir = join(testDataDir, "test_5");

describe("loadGlobalConfig", () => {
  test("loads a valid global config", () => {
    const globalConfigPath = join(test1Dir, "config.toml");
    const config = loadGlobalConfig(globalConfigPath);
    expect(config.ok).toBe(true);
    if (config.ok) {
      expect(config.value.serveApi).toBe(true);
      expect(config.value.serveDashboard).toBe(false);
      expect(config.value.telegram).toBeDefined();
      expect(config.value.pagerduty).toBeDefined();
      expect(config.value.discord).toBeDefined();
      expect(config.value.chainConfigs).toBeDefined();
      expect(config.value.healthCheck).toBeDefined();
    } else {
      throw config.error;
    }
  });

  test("Dashboard and API test", () => {
    const globalConfigPath = join(test2Dir, "config.toml");
    const config = loadGlobalConfig(globalConfigPath);
    expect(config.ok).toBe(false);
    if (config.ok) {
      throw new Error("Unexpected success");
    } else {
      expect(config.error).toBeInstanceOf(GeneralLoaderError);
    }
  });

  test("ArkError", () => {
    const globalConfigPath = join(test3Dir, "config.toml");
    const config = loadGlobalConfig(globalConfigPath);
    expect(config.ok).toBe(false);
    if (config.ok) {
      throw new Error("Unexpected success");
    } else {
      expect(config.error).toBeInstanceOf(ArkLoaderError);
    }
  });
});

describe("loadChainConfig", () => {
  test("loads a valid chain config", () => {
    const configs = loadChainConfigs(test4Dir);
    expect(configs.ok).toBe(true);
    if (configs.ok) {
      expect(configs.value.size).toBe(3);
    }
  });

  test("ArkError", () => {
    const configs = loadChainConfigs(test5Dir);
    expect(configs.ok).toBe(false);
    if (configs.ok) {
      throw new Error("Unexpected success");
    } else {
      expect(configs.error).toBeInstanceOf(ArkLoaderError);
    }
  });
});

describe("duration settings", () => {
  const chainToml = (extra: string) => `
pretty_name = "Test"
chain_type = "tm2"
operator_address = "g1abc"
signing_address = "g1abc"
rpc_urls = [{ url = "https://rpc.example.com", alert_if_down = true }]
${extra}
alert_config = {
  alert_if_inactive = true,
  endpoint_down_alert_after = "2m",
  notify_retry_pause = "30s",
  notify_retry_max_pause = "1h",
  stalled_alert = { enabled = true, stalled_threshold = "1m" },
  consecutive_miss_alert = { enabled = true, threshold = 50, repeat = true, repeat_interval = "5m" },
  percentage_missed_blocks_alert = { enabled = false, threshold = 10.0, repeat = false }
}`;

  function load(extra: string) {
    const dir = mkdtempSync(join(tmpdir(), "cosmad_duration_"));
    try {
      writeFileSync(join(dir, "test-1.toml"), chainToml(extra));
      const result = loadChainConfigs(dir);
      if (!result.ok) throw result.error;
      return result.value.get("test-1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("strings with units are parsed into the units the app uses", () => {
    const chain = load('poll_interval = "6s"\nhealth_check_interval = "1m"');
    expect(chain?.pollIntervalMs).toBe(6_000);
    expect(chain?.healthCheckInterval).toBe(60);
    expect(chain?.alertConfig.endpointDownAlertAfter).toBe(120);
    expect(chain?.alertConfig.notifyRetryPause).toBe(30);
    expect(chain?.alertConfig.notifyRetryMaxPause).toBe(3600);
    expect(chain?.alertConfig.stalledAlert.stalledThreshold).toBe(60);
    expect(chain?.alertConfig.consecutiveMissAlert.repeatInterval).toBe(300);
  });

  test("the old poll_interval_ms with a bare number still works", () => {
    expect(load("poll_interval_ms = 3000")?.pollIntervalMs).toBe(3_000);
  });
});
