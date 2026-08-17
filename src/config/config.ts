import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { ArkErrors } from "arktype";
import camelcaseKeys from "camelcase-keys";
import TOML from "smol-toml";
import logger from "../pkgs/logger";
import type { Result } from "../pkgs/models/result";
import { ChainConfig, type ChainConfigType } from "./chain_types";
import { ArkLoaderError, GeneralLoaderError } from "./errors";
import { GlobalConfig, type GlobalConfigType } from "./global_config";

const log = logger.child({ module: "config" });

/**
 * A helper function to load the global config from a toml file.
 * @param filePath path to the config.toml
 * @returns the parsed and validated global config
 */
export function loadGlobalConfig(filePath: string): Result<GlobalConfigType, Error> {
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
    log.error(`Invalid global config: ${config.summary}, ${config.flatProblemsByPath}`);
    return {
      ok: false,
      error: new ArkLoaderError(
        `Invalid global config: ${config.summary}, ${config.flatProblemsByPath}`,
        { summary: config.summary, flatProblemsByPath: config.flatProblemsByPath },
      ),
    };
  }

  const vError = validateGlobalConfig(config);
  if (vError) {
    return { ok: false, error: vError };
  }

  return { ok: true, value: config };
}

/**
 * A helper function to load chain configs from a directory of toml files.
 * @param dirPath path to directory that contains the chain toml files.
 * @returns Map of chain id to chain config.
 */
export function loadChainConfigs(dirPath: string): Result<Map<string, ChainConfigType>, Error> {
  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".toml"));

  if (files.length === 0) {
    // No chain config files found, return an empty map. Which is okay if there are chains in the global config.
    return { ok: true, value: new Map() };
  }

  const configs = new Map<string, ChainConfigType>();
  const chainIdSet = new Set<string>();

  for (const file of files) {
    const chainId = path.basename(file, ".toml");

    if (chainIdSet.has(chainId)) {
      const error = `Duplicate chain config: ${chainId}`;
      log.error(error);
      return { ok: false, error: new GeneralLoaderError(error) };
    }
    chainIdSet.add(chainId);

    const raw = fs.readFileSync(path.join(dirPath, file), "utf8");
    const parsed = TOML.parse(raw);
    const normalized = camelcaseKeys(parsed as Record<string, unknown>, { deep: true });
    const config = ChainConfig(normalized);

    if (config instanceof ArkErrors) {
      const error = `Invalid chain config: ${config.summary}, ${config.flatProblemsByPath}`;
      log.error(error);
      return {
        ok: false,
        error: new ArkLoaderError(error, {
          summary: config.summary,
          flatProblemsByPath: config.flatProblemsByPath,
        }),
      };
    }

    const vError = validateChainConfig(chainId, config);
    if (vError) {
      return { ok: false, error: vError };
    }

    configs.set(chainId, config);
  }

  return { ok: true, value: configs };
}

// Helper function to validate a chain config.
function validateChainConfig(chainId: string, config: ChainConfigType): null | GeneralLoaderError {
  if (config.rpcUrls.length === 0) {
    const error = `Chain config is missing rpcUrls: ${chainId}`;
    log.error(error);
    return new GeneralLoaderError(error);
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
    const error = `Chain config is missing valconsAddress: ${chainId}`;
    log.error(error);
    return new GeneralLoaderError(error);
  }

  if (config.chainType === "bft" && (!config.apiUrls || config.apiUrls.length === 0)) {
    const error = `Chain config is missing apiUrls (required for bft chains): ${chainId}`;
    log.error(error);
    return new GeneralLoaderError(error);
  }

  if (config.alertConfig.signingWindowSize != null) {
    log.warn(
      `Chain ${chainId} sets alertConfig.signingWindowSize explicitly this overrides the ` +
        "chain's own signed_blocks_window (bft) and isn't recommended unless you have a specific reason to diverge from it.",
    );
  }

  return null;
}

// Helper function to validate the global config.
function validateGlobalConfig(config: GlobalConfigType): null | GeneralLoaderError {
  if (config.serveDashboard && !config.serveApi) {
    const error = `For dashboard to work, serveApi must be enabled`;
    log.error(error);
    return new GeneralLoaderError(error);
  }

  const haveAlertEnabled =
    config.discord !== undefined || config.telegram !== undefined || config.pagerduty !== undefined;

  if (!haveAlertEnabled) {
    log.warn(`No global alert enabled: discord, telegram, and pagerduty are all undefined`);
  }

  if (config.chainConfigs) {
    for (const [chainId, chainConfig] of Object.entries(config.chainConfigs)) {
      const vError = validateChainConfig(chainId, chainConfig);
      if (vError) {
        return vError;
      }
    }
  }

  return null;
}
