import fs from "node:fs";
import path from "node:path";
import camelcaseKeys from "camelcase-keys";
import TOML from "smol-toml";
import { ChainConfig, type ChainConfigType } from "./chain_types";
import { GlobalConfig, type GlobalConfigType } from "./global_config";
import { ArkErrors } from "arktype";
import logger from "../pkgs/logger";
import process from "node:process";

const log = logger.child({ module: "config_dp_loader" });

/**
 * A helper function to load the global config from a toml file.
 * @param filePath path to the config.toml
 * @returns the parsed and validated global config
 */
export function loadGlobalConfig(filePath: string): GlobalConfigType {

  // If the main config is in any way invalid, exit the process.
  if (!filePath.endsWith(".toml")) {
    log.error(`Expected a .toml file, got ${filePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = TOML.parse(raw);
  const normalized = camelcaseKeys(parsed as Record<string, unknown>, { deep: true });
  const config = GlobalConfig(normalized);

  if (config instanceof ArkErrors) {
    log.error(`Invalid global config: ${config.flatProblemsByPath}`);
    process.exit(1);
  }

  validateGlobalConfig(config);
  return config;
}

/**
 * A helper function to load chain configs from a directory of toml files.
 * @param dirPath path to directory that contains the chain toml files.
 * @returns Map of chain id to chain config.
 */
export function loadChainConfigs(dirPath: string): Map<string, ChainConfigType> {
  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".toml"));

  if (files.length === 0) {
    return new Map();
  }

  const configs = new Map<string, ChainConfigType>();
  const chainIdSet = new Set<string>();

  for (const file of files) {
    const chainId = path.basename(file, ".toml");

    if (chainIdSet.has(chainId)) {
      log.error(`Duplicate chain config: ${chainId}`);
      process.exit(1);
    }
    chainIdSet.add(chainId);

    const raw = fs.readFileSync(path.join(dirPath, file), "utf8");
    const parsed = TOML.parse(raw);
    const normalized = camelcaseKeys(parsed as Record<string, unknown>, { deep: true });
    const config = ChainConfig(normalized);

    if (config instanceof ArkErrors) {
      log.error(`Invalid chain config: ${config.flatProblemsByPath}`);
      process.exit(1);
    }

    validateChainConfig(chainId, config);
    configs.set(chainId, config);
  }

  return configs;
}

// Helper function to validate a chain config.
function validateChainConfig(chainId: string, config: ChainConfigType) {

  if (config.rpcUrls.length === 0) {
    log.error(`Chain config is missing rpcUrls: ${chainId}`);
    process.exit(1);
  }

  // check RPC and API URLs and remove "/" at the last index.
  for (let i = 0; i < config.rpcUrls.length; i++) {
    if (config.rpcUrls[i].url.endsWith("/")) {
      config.rpcUrls[i].url = config.rpcUrls[i].url.slice(0, -1);
    }
  }

  if (config.apiUrls) {
    for (let i = 0; i < config.apiUrls.length; i++) {
      if (config.apiUrls[i].url.endsWith("/")) {
        config.apiUrls[i].url = config.apiUrls[i].url.slice(0, -1);
      }
    }
  }

  if (config.chainType === "bft" && !config.valconsAddress) {
    log.error(`Chain config is missing valconsAddress: ${chainId}`);
    process.exit(1);
  }

}

// Helper function to validate the global config.
function validateGlobalConfig(config: GlobalConfigType) {
  if (config.serveDashboard && !config.serveApi) {
    log.error(`For dashboard to work, serveApi must be enabled`);
    process.exit(1);
  }

  const haveAlertEnabled = config.discord !== undefined ||
    config.telegram !== undefined || config.pagerduty !== undefined;

  if (!haveAlertEnabled) {
    log.warn(`No global alert enabled: discord, telegram, and pagerduty are all undefined`);
  }

  if (config.chainConfigs) {
    for (const [chainId, chainConfig] of Object.entries(config.chainConfigs)) {
      validateChainConfig(chainId, chainConfig);
    }
  }
}
