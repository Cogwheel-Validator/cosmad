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
