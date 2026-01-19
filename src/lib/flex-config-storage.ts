/**
 * Storage utilities for IBKR Flex Query configurations
 *
 * Stores configs as JSON in the secrets API (encrypted in system keyring).
 */

import { debug } from "./debug-logger";
import { getErrorMessage } from "./shared-utils";
import { AsyncLock, withLock } from "./async-lock";

/**
 * Module-level lock to prevent concurrent read-modify-write operations.
 * This prevents TOCTOU race conditions when multiple operations try to
 * modify configs simultaneously.
 */
const configLock = new AsyncLock();

// Type for the secrets API from addon context
interface SecretsAPI {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

// Storage keys
export const SECRET_FLEX_TOKEN = "flex_token";
export const SECRET_FLEX_CONFIGS = "flex_query_configs";

/**
 * Configuration for a single Flex Query
 */
export interface FlexQueryConfig {
  id: string;
  name: string;
  queryId: string;
  accountGroup: string;
  autoFetchEnabled: boolean;
  lastFetchTime?: string;
  lastFetchStatus?: "success" | "error";
  lastFetchError?: string;
}

/**
 * Result type for config loading that distinguishes between success and failure
 */
export interface LoadConfigsResult {
  /** Whether loading succeeded */
  success: boolean;
  /** The loaded configs (empty array if no configs exist, undefined if failed) */
  configs: FlexQueryConfig[] | undefined;
  /** Error message if loading failed */
  error?: string;
}

/**
 * Load all Flex Query configurations from storage with explicit error handling
 * Returns a result object that distinguishes between "no configs" and "load failed"
 */
export async function loadConfigsSafe(secrets: SecretsAPI): Promise<LoadConfigsResult> {
  try {
    const json = await secrets.get(SECRET_FLEX_CONFIGS);
    if (!json) {
      return { success: true, configs: [] };
    }
    const parsed = JSON.parse(json);

    // Validate parsed result is an array
    if (!Array.isArray(parsed)) {
      debug.error("Flex Query configs storage is corrupted (not an array), resetting to empty");
      return { success: true, configs: [] };
    }

    // Validate each config has required fields
    const validConfigs: FlexQueryConfig[] = [];
    for (const config of parsed) {
      if (
        typeof config === "object" &&
        config !== null &&
        typeof config.id === "string" &&
        typeof config.name === "string" &&
        typeof config.queryId === "string" &&
        typeof config.accountGroup === "string"
      ) {
        validConfigs.push(config as FlexQueryConfig);
      } else {
        debug.warn("Skipping invalid config entry:", config);
      }
    }

    return { success: true, configs: validConfigs };
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    debug.error("Failed to load Flex Query configs:", errorMsg);
    return { success: false, configs: undefined, error: errorMsg };
  }
}

/**
 * Load all Flex Query configurations from storage
 * @deprecated Use loadConfigsSafe() to properly handle errors
 * This function returns [] on error which is indistinguishable from "no configs"
 */
export async function loadConfigs(secrets: SecretsAPI): Promise<FlexQueryConfig[]> {
  const result = await loadConfigsSafe(secrets);
  return result.configs ?? [];
}

/**
 * Save all Flex Query configurations to storage
 */
export async function saveConfigs(
  secrets: SecretsAPI,
  configs: FlexQueryConfig[]
): Promise<void> {
  await secrets.set(SECRET_FLEX_CONFIGS, JSON.stringify(configs));
}

/**
 * Add a new config
 * Uses a lock to prevent race conditions with concurrent modifications.
 */
export async function addConfig(
  secrets: SecretsAPI,
  config: Omit<FlexQueryConfig, "id">
): Promise<FlexQueryConfig> {
  return withLock(configLock, async () => {
    const configs = await loadConfigs(secrets);
    const newConfig: FlexQueryConfig = {
      ...config,
      id: crypto.randomUUID(),
    };
    configs.push(newConfig);
    await saveConfigs(secrets, configs);
    return newConfig;
  });
}

/**
 * Update an existing config
 * Uses a lock to prevent race conditions with concurrent modifications.
 */
export async function updateConfig(
  secrets: SecretsAPI,
  id: string,
  updates: Partial<Omit<FlexQueryConfig, "id">>
): Promise<FlexQueryConfig | null> {
  return withLock(configLock, async () => {
    const configs = await loadConfigs(secrets);
    const index = configs.findIndex((c) => c.id === id);
    if (index === -1) return null;

    configs[index] = { ...configs[index], ...updates };
    await saveConfigs(secrets, configs);
    return configs[index];
  });
}

/**
 * Delete a config by ID
 * Uses a lock to prevent race conditions with concurrent modifications.
 */
export async function deleteConfig(secrets: SecretsAPI, id: string): Promise<boolean> {
  return withLock(configLock, async () => {
    const configs = await loadConfigs(secrets);
    const filtered = configs.filter((c) => c.id !== id);
    if (filtered.length === configs.length) return false;

    await saveConfigs(secrets, filtered);
    return true;
  });
}

/**
 * Load the shared Flex Token
 */
export async function loadToken(secrets: SecretsAPI): Promise<string | null> {
  return secrets.get(SECRET_FLEX_TOKEN);
}

/**
 * Save the shared Flex Token
 */
export async function saveToken(secrets: SecretsAPI, token: string): Promise<void> {
  await secrets.set(SECRET_FLEX_TOKEN, token);
}

/**
 * Delete the shared Flex Token
 */
export async function deleteToken(secrets: SecretsAPI): Promise<void> {
  await secrets.delete(SECRET_FLEX_TOKEN);
}

/**
 * Update config status with proper locking to prevent race conditions.
 * Uses a lock to ensure atomic read-modify-write operations.
 */
export async function updateConfigStatus(
  secrets: SecretsAPI,
  id: string,
  status: {
    lastFetchTime?: string;
    lastFetchStatus?: "success" | "error";
    lastFetchError?: string;
  }
): Promise<void> {
  await withLock(configLock, async () => {
    const configs = await loadConfigs(secrets);
    const index = configs.findIndex((c) => c.id === id);
    if (index === -1) {
      debug.warn(`[Flex Config] Cannot update status: config ${id} not found`);
      return;
    }

    configs[index] = { ...configs[index], ...status };
    await saveConfigs(secrets, configs);
  });
}
