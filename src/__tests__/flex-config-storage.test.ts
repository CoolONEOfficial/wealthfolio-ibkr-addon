import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadConfigs,
  saveConfigs,
  addConfig,
  updateConfig,
  deleteConfig,
  loadToken,
  saveToken,
  deleteToken,
  updateConfigStatus,
  SECRET_FLEX_TOKEN,
  SECRET_FLEX_CONFIGS,
  type FlexQueryConfig,
} from "../lib/flex-config-storage";

// Mock secrets API
function createMockSecretsAPI(initialData: Record<string, string> = {}) {
  const storage = new Map<string, string>(Object.entries(initialData));

  return {
    get: vi.fn(async (key: string) => storage.get(key) || null),
    set: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    // Helper to inspect storage
    _storage: storage,
  };
}

describe("Flex Config Storage", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(crypto, "randomUUID").mockReturnValue("test-uuid-123");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Storage keys", () => {
    it("should have correct storage keys", () => {
      expect(SECRET_FLEX_TOKEN).toBe("flex_token");
      expect(SECRET_FLEX_CONFIGS).toBe("flex_query_configs");
    });
  });

  describe("loadConfigs", () => {
    it("should return empty array when no configs exist", async () => {
      const secrets = createMockSecretsAPI();

      const result = await loadConfigs(secrets);

      expect(result).toEqual([]);
      expect(secrets.get).toHaveBeenCalledWith(SECRET_FLEX_CONFIGS);
    });

    it("should parse and return stored configs", async () => {
      const configs: FlexQueryConfig[] = [
        {
          id: "config-1",
          name: "My Config",
          queryId: "12345",
          accountGroup: "IBKR",
          autoFetchEnabled: true,
        },
      ];
      const secrets = createMockSecretsAPI({
        [SECRET_FLEX_CONFIGS]: JSON.stringify(configs),
      });

      const result = await loadConfigs(secrets);

      expect(result).toEqual(configs);
    });

    it("should return empty array on JSON parse error", async () => {
      const secrets = createMockSecretsAPI({
        [SECRET_FLEX_CONFIGS]: "invalid-json",
      });

      const result = await loadConfigs(secrets);

      expect(result).toEqual([]);
      expect(console.error).toHaveBeenCalled();
    });

    it("should handle API errors gracefully", async () => {
      const secrets = createMockSecretsAPI();
      secrets.get.mockRejectedValue(new Error("Storage error"));

      const result = await loadConfigs(secrets);

      expect(result).toEqual([]);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe("saveConfigs", () => {
    it("should stringify and save configs", async () => {
      const secrets = createMockSecretsAPI();
      const configs: FlexQueryConfig[] = [
        {
          id: "config-1",
          name: "Test",
          queryId: "12345",
          accountGroup: "IBKR",
          autoFetchEnabled: false,
        },
      ];

      await saveConfigs(secrets, configs);

      expect(secrets.set).toHaveBeenCalledWith(
        SECRET_FLEX_CONFIGS,
        JSON.stringify(configs)
      );
    });

    it("should save empty array", async () => {
      const secrets = createMockSecretsAPI();

      await saveConfigs(secrets, []);

      expect(secrets.set).toHaveBeenCalledWith(SECRET_FLEX_CONFIGS, "[]");
    });
  });

  describe("addConfig", () => {
    it("should add new config with generated UUID", async () => {
      const secrets = createMockSecretsAPI();
      const newConfig = {
        name: "New Config",
        queryId: "99999",
        accountGroup: "Test",
        autoFetchEnabled: true,
      };

      const result = await addConfig(secrets, newConfig);

      expect(result.id).toBe("test-uuid-123");
      expect(result.name).toBe("New Config");
      expect(result.queryId).toBe("99999");
    });

    it("should append to existing configs", async () => {
      const existingConfig: FlexQueryConfig = {
        id: "existing-1",
        name: "Existing",
        queryId: "11111",
        accountGroup: "IBKR",
        autoFetchEnabled: false,
      };
      const secrets = createMockSecretsAPI({
        [SECRET_FLEX_CONFIGS]: JSON.stringify([existingConfig]),
      });

      await addConfig(secrets, {
        name: "New",
        queryId: "22222",
        accountGroup: "IBKR",
        autoFetchEnabled: true,
      });

      // Check that saved configs include both
      const savedCall = secrets.set.mock.calls.find(
        (call) => call[0] === SECRET_FLEX_CONFIGS
      );
      const savedConfigs = JSON.parse(savedCall![1]);
      expect(savedConfigs).toHaveLength(2);
      expect(savedConfigs[0].id).toBe("existing-1");
      expect(savedConfigs[1].id).toBe("test-uuid-123");
    });
  });

  describe("updateConfig", () => {
    it("should update existing config", async () => {
      const config: FlexQueryConfig = {
        id: "config-1",
        name: "Original",
        queryId: "12345",
        accountGroup: "IBKR",
        autoFetchEnabled: false,
      };
      const secrets = createMockSecretsAPI({
        [SECRET_FLEX_CONFIGS]: JSON.stringify([config]),
      });

      const result = await updateConfig(secrets, "config-1", {
        name: "Updated",
        autoFetchEnabled: true,
      });

      expect(result).not.toBeNull();
      expect(result!.name).toBe("Updated");
      expect(result!.autoFetchEnabled).toBe(true);
      expect(result!.queryId).toBe("12345"); // Unchanged
    });

    it("should return null for non-existent config", async () => {
      const secrets = createMockSecretsAPI({
        [SECRET_FLEX_CONFIGS]: JSON.stringify([]),
      });

      const result = await updateConfig(secrets, "non-existent", { name: "Test" });

      expect(result).toBeNull();
    });

    it("should preserve other configs when updating", async () => {
      const configs: FlexQueryConfig[] = [
        { id: "config-1", name: "First", queryId: "111", accountGroup: "A", autoFetchEnabled: false },
        { id: "config-2", name: "Second", queryId: "222", accountGroup: "B", autoFetchEnabled: false },
      ];
      const secrets = createMockSecretsAPI({
        [SECRET_FLEX_CONFIGS]: JSON.stringify(configs),
      });

      await updateConfig(secrets, "config-1", { name: "Updated First" });

      const savedCall = secrets.set.mock.calls[0];
      const savedConfigs = JSON.parse(savedCall[1]);
      expect(savedConfigs).toHaveLength(2);
      expect(savedConfigs[0].name).toBe("Updated First");
      expect(savedConfigs[1].name).toBe("Second");
    });
  });

  describe("deleteConfig", () => {
    it("should delete existing config", async () => {
      const config: FlexQueryConfig = {
        id: "config-1",
        name: "To Delete",
        queryId: "12345",
        accountGroup: "IBKR",
        autoFetchEnabled: false,
      };
      const secrets = createMockSecretsAPI({
        [SECRET_FLEX_CONFIGS]: JSON.stringify([config]),
      });

      const result = await deleteConfig(secrets, "config-1");

      expect(result).toBe(true);
      const savedCall = secrets.set.mock.calls[0];
      const savedConfigs = JSON.parse(savedCall[1]);
      expect(savedConfigs).toHaveLength(0);
    });

    it("should return false for non-existent config", async () => {
      const secrets = createMockSecretsAPI({
        [SECRET_FLEX_CONFIGS]: JSON.stringify([]),
      });

      const result = await deleteConfig(secrets, "non-existent");

      expect(result).toBe(false);
    });

    it("should preserve other configs when deleting", async () => {
      const configs: FlexQueryConfig[] = [
        { id: "config-1", name: "First", queryId: "111", accountGroup: "A", autoFetchEnabled: false },
        { id: "config-2", name: "Second", queryId: "222", accountGroup: "B", autoFetchEnabled: false },
      ];
      const secrets = createMockSecretsAPI({
        [SECRET_FLEX_CONFIGS]: JSON.stringify(configs),
      });

      await deleteConfig(secrets, "config-1");

      const savedCall = secrets.set.mock.calls[0];
      const savedConfigs = JSON.parse(savedCall[1]);
      expect(savedConfigs).toHaveLength(1);
      expect(savedConfigs[0].id).toBe("config-2");
    });
  });

  describe("Token operations", () => {
    describe("loadToken", () => {
      it("should return token if exists", async () => {
        const secrets = createMockSecretsAPI({
          [SECRET_FLEX_TOKEN]: "my-secret-token",
        });

        const result = await loadToken(secrets);

        expect(result).toBe("my-secret-token");
      });

      it("should return null if no token", async () => {
        const secrets = createMockSecretsAPI();

        const result = await loadToken(secrets);

        expect(result).toBeNull();
      });
    });

    describe("saveToken", () => {
      it("should save token", async () => {
        const secrets = createMockSecretsAPI();

        await saveToken(secrets, "new-token");

        expect(secrets.set).toHaveBeenCalledWith(SECRET_FLEX_TOKEN, "new-token");
      });
    });

    describe("deleteToken", () => {
      it("should delete token", async () => {
        const secrets = createMockSecretsAPI({
          [SECRET_FLEX_TOKEN]: "existing-token",
        });

        await deleteToken(secrets);

        expect(secrets.delete).toHaveBeenCalledWith(SECRET_FLEX_TOKEN);
      });
    });
  });

  describe("updateConfigStatus", () => {
    it("should update status fields atomically", async () => {
      const config: FlexQueryConfig = {
        id: "config-1",
        name: "Test",
        queryId: "12345",
        accountGroup: "IBKR",
        autoFetchEnabled: true,
      };
      const secrets = createMockSecretsAPI({
        [SECRET_FLEX_CONFIGS]: JSON.stringify([config]),
      });

      await updateConfigStatus(secrets, "config-1", {
        lastFetchTime: "2024-01-15T12:00:00Z",
        lastFetchStatus: "success",
      });

      // Verify it loaded fresh configs before updating
      expect(secrets.get).toHaveBeenCalledWith(SECRET_FLEX_CONFIGS);

      const savedCall = secrets.set.mock.calls[0];
      const savedConfigs = JSON.parse(savedCall[1]);
      expect(savedConfigs[0].lastFetchTime).toBe("2024-01-15T12:00:00Z");
      expect(savedConfigs[0].lastFetchStatus).toBe("success");
    });

    it("should update error status", async () => {
      const config: FlexQueryConfig = {
        id: "config-1",
        name: "Test",
        queryId: "12345",
        accountGroup: "IBKR",
        autoFetchEnabled: true,
      };
      const secrets = createMockSecretsAPI({
        [SECRET_FLEX_CONFIGS]: JSON.stringify([config]),
      });

      await updateConfigStatus(secrets, "config-1", {
        lastFetchTime: "2024-01-15T12:00:00Z",
        lastFetchStatus: "error",
        lastFetchError: "Network timeout",
      });

      const savedCall = secrets.set.mock.calls[0];
      const savedConfigs = JSON.parse(savedCall[1]);
      expect(savedConfigs[0].lastFetchStatus).toBe("error");
      expect(savedConfigs[0].lastFetchError).toBe("Network timeout");
    });

    it("should warn and skip if config not found", async () => {
      const secrets = createMockSecretsAPI({
        [SECRET_FLEX_CONFIGS]: JSON.stringify([]),
      });

      await updateConfigStatus(secrets, "non-existent", {
        lastFetchStatus: "success",
      });

      expect(console.warn).toHaveBeenCalled();
      expect(secrets.set).not.toHaveBeenCalled();
    });

    it("should preserve other config fields", async () => {
      const config: FlexQueryConfig = {
        id: "config-1",
        name: "Test",
        queryId: "12345",
        accountGroup: "IBKR",
        autoFetchEnabled: true,
        lastFetchTime: "2024-01-14T12:00:00Z",
        lastFetchStatus: "error",
        lastFetchError: "Old error",
      };
      const secrets = createMockSecretsAPI({
        [SECRET_FLEX_CONFIGS]: JSON.stringify([config]),
      });

      await updateConfigStatus(secrets, "config-1", {
        lastFetchTime: "2024-01-15T12:00:00Z",
        lastFetchStatus: "success",
        lastFetchError: undefined,
      });

      const savedCall = secrets.set.mock.calls[0];
      const savedConfigs = JSON.parse(savedCall[1]);
      expect(savedConfigs[0].name).toBe("Test");
      expect(savedConfigs[0].queryId).toBe("12345");
      expect(savedConfigs[0].autoFetchEnabled).toBe(true);
    });
  });

  describe("Concurrent update simulation", () => {
    it("should handle sequential updates correctly", async () => {
      // Simulates the "atomic" pattern of load-modify-save
      const config: FlexQueryConfig = {
        id: "config-1",
        name: "Test",
        queryId: "12345",
        accountGroup: "IBKR",
        autoFetchEnabled: true,
      };

      // Use a real-ish storage that persists between calls
      const storage = new Map<string, string>();
      storage.set(SECRET_FLEX_CONFIGS, JSON.stringify([config]));

      const secrets = {
        get: vi.fn(async (key: string) => storage.get(key) || null),
        set: vi.fn(async (key: string, value: string) => {
          storage.set(key, value);
        }),
        delete: vi.fn(async (key: string) => {
          storage.delete(key);
        }),
      };

      // First update
      await updateConfigStatus(secrets, "config-1", {
        lastFetchTime: "2024-01-15T12:00:00Z",
        lastFetchStatus: "success",
      });

      // Second update (should see first update's changes)
      await updateConfigStatus(secrets, "config-1", {
        lastFetchTime: "2024-01-15T13:00:00Z",
        lastFetchStatus: "error",
        lastFetchError: "New error",
      });

      // Final state should have latest values
      const finalConfigs = JSON.parse(storage.get(SECRET_FLEX_CONFIGS)!);
      expect(finalConfigs[0].lastFetchTime).toBe("2024-01-15T13:00:00Z");
      expect(finalConfigs[0].lastFetchStatus).toBe("error");
      expect(finalConfigs[0].lastFetchError).toBe("New error");
    });
  });
});
