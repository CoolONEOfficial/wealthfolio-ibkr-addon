/**
 * React Query hooks for managing IBKR Flex Query configurations
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FlexQueryConfig,
  loadConfigsSafe,
  addConfig,
  updateConfig,
  deleteConfig,
  loadToken,
  saveToken,
  deleteToken,
} from "../lib/flex-config-storage";

// Type for the secrets API from addon context
interface SecretsAPI {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

// Query keys
const QUERY_KEYS = {
  configs: ["flex-configs"] as const,
  token: ["flex-token"] as const,
};

/**
 * Hook to fetch all Flex Query configurations
 */
export function useFlexConfigs(secrets: SecretsAPI | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.configs,
    queryFn: async () => {
      if (!secrets) return [];
      const result = await loadConfigsSafe(secrets);
      if (!result.success) {
        throw new Error(result.error || "Failed to load configurations");
      }
      return result.configs ?? [];
    },
    enabled: !!secrets,
  });
}

/**
 * Hook to fetch the shared Flex Token
 */
export function useFlexToken(secrets: SecretsAPI | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.token,
    queryFn: () => (secrets ? loadToken(secrets) : Promise.resolve(null)),
    enabled: !!secrets,
  });
}

/**
 * Hook to add a new Flex Query configuration
 */
export function useAddConfig(secrets: SecretsAPI | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: Omit<FlexQueryConfig, "id">) => {
      if (!secrets) throw new Error("Secrets API not available");
      return addConfig(secrets, config);
    },
    onSuccess: (newConfig) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.configs });
      toast.success(`Added "${newConfig.name}" configuration`);
    },
    onError: (error) => {
      toast.error(`Failed to add configuration: ${error.message}`);
    },
  });
}

/**
 * Hook to update an existing Flex Query configuration
 */
export function useUpdateConfig(secrets: SecretsAPI | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Omit<FlexQueryConfig, "id">>;
    }) => {
      if (!secrets) throw new Error("Secrets API not available");
      const result = await updateConfig(secrets, id, updates);
      if (!result) throw new Error("Configuration not found");
      return result;
    },
    onSuccess: (updatedConfig) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.configs });
      toast.success(`Updated "${updatedConfig.name}" configuration`);
    },
    onError: (error) => {
      toast.error(`Failed to update configuration: ${error.message}`);
    },
  });
}

/**
 * Hook to delete a Flex Query configuration
 */
export function useDeleteConfig(secrets: SecretsAPI | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!secrets) throw new Error("Secrets API not available");
      const result = await deleteConfig(secrets, id);
      if (!result) throw new Error("Configuration not found");
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.configs });
      toast.success("Configuration deleted");
    },
    onError: (error) => {
      toast.error(`Failed to delete configuration: ${error.message}`);
    },
  });
}

/**
 * Hook to save the shared Flex Token
 */
export function useSaveToken(secrets: SecretsAPI | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (token: string) => {
      if (!secrets) throw new Error("Secrets API not available");
      await saveToken(secrets, token);
      return token;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.token });
      toast.success("Token saved");
    },
    onError: (error) => {
      toast.error(`Failed to save token: ${error.message}`);
    },
  });
}

/**
 * Hook to delete the shared Flex Token
 */
export function useDeleteToken(secrets: SecretsAPI | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!secrets) throw new Error("Secrets API not available");
      await deleteToken(secrets);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.token });
      toast.success("Token deleted");
    },
    onError: (error) => {
      toast.error(`Failed to delete token: ${error.message}`);
    },
  });
}

/**
 * Hook to update the status of a config after a fetch attempt
 * (Used by auto-fetch, doesn't show toast)
 */
export function useUpdateConfigStatus(secrets: SecretsAPI | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
      error,
    }: {
      id: string;
      status: "success" | "error";
      error?: string;
    }) => {
      if (!secrets) throw new Error("Secrets API not available");
      const updates: Partial<FlexQueryConfig> = {
        lastFetchTime: new Date().toISOString(),
        lastFetchStatus: status,
        lastFetchError: status === "error" ? error : undefined,
      };
      return updateConfig(secrets, id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.configs });
    },
  });
}
