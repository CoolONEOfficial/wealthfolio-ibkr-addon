/**
 * Storage utilities for IBKR Flex Query configurations
 *
 * Stores configs as JSON in the secrets API (encrypted in system keyring).
 */

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
 * Load all Flex Query configurations from storage
 */
export async function loadConfigs(secrets: SecretsAPI): Promise<FlexQueryConfig[]> {
  try {
    const json = await secrets.get(SECRET_FLEX_CONFIGS);
    if (!json) return [];
    return JSON.parse(json) as FlexQueryConfig[];
  } catch (error) {
    console.error("Failed to load Flex Query configs:", error);
    return [];
  }
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
 */
export async function addConfig(
  secrets: SecretsAPI,
  config: Omit<FlexQueryConfig, "id">
): Promise<FlexQueryConfig> {
  const configs = await loadConfigs(secrets);
  const newConfig: FlexQueryConfig = {
    ...config,
    id: crypto.randomUUID(),
  };
  configs.push(newConfig);
  await saveConfigs(secrets, configs);
  return newConfig;
}

/**
 * Update an existing config
 */
export async function updateConfig(
  secrets: SecretsAPI,
  id: string,
  updates: Partial<Omit<FlexQueryConfig, "id">>
): Promise<FlexQueryConfig | null> {
  const configs = await loadConfigs(secrets);
  const index = configs.findIndex((c) => c.id === id);
  if (index === -1) return null;

  configs[index] = { ...configs[index], ...updates };
  await saveConfigs(secrets, configs);
  return configs[index];
}

/**
 * Delete a config by ID
 */
export async function deleteConfig(secrets: SecretsAPI, id: string): Promise<boolean> {
  const configs = await loadConfigs(secrets);
  const filtered = configs.filter((c) => c.id !== id);
  if (filtered.length === configs.length) return false;

  await saveConfigs(secrets, filtered);
  return true;
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
