/**
 * Addon Registration Tests
 *
 * Regression tests for the Wealthfolio 3.x addon runtime:
 * - routes and sidebar items must live in the addon's own namespace
 *   (/addons/<addon-id>[/...]); otherwise the host rejects them with
 *   "cannot register route"
 * - routes are registered as plain components (no React.lazy) with stable ids
 * - sidebar icons come from the curated host icon set
 * - the portfolio update listener is registered and everything is cleaned up on disable
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ADDON_ICON_NAMES } from "@wealthfolio/addon-sdk";
import type { AddonContext, RouteConfig, SidebarItemConfig } from "@wealthfolio/addon-sdk";
import manifest from "../../manifest.json";
import { enable } from "../addon";
import { hasNetworkClient } from "../lib/network-client";
import { ADDON_ID, IMPORT_ROUTE, SETTINGS_ROUTE } from "../lib/constants";

// Keep the test focused on registration: page components are not rendered here
vi.mock("../pages/ibkr-multi-import-page", () => ({ default: () => null }));
vi.mock("../pages/ibkr-flex-settings-page", () => ({ default: () => null }));

/** Same namespace extraction the host uses in addons-runtime-context.ts */
function getRouteNamespace(path: string): string | undefined {
  const match = /^\/addons?\/([^/]+)(?:\/|$)/.exec(path);
  return match ? match[1].toLowerCase() : undefined;
}

function createMockContext() {
  const routes: RouteConfig[] = [];
  const sidebarItems: SidebarItemConfig[] = [];
  const sidebarRemove = vi.fn();
  const disableCallbacks: (() => void)[] = [];
  const unlisten = vi.fn();
  const onUpdateComplete = vi.fn().mockResolvedValue(unlisten);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn(), debug: vi.fn() };

  const ctx = {
    router: { add: vi.fn((route: RouteConfig) => routes.push(route)) },
    sidebar: {
      addItem: vi.fn((item: SidebarItemConfig) => {
        sidebarItems.push(item);
        return { remove: sidebarRemove };
      }),
    },
    onDisable: vi.fn((callback: () => void) => disableCallbacks.push(callback)),
    api: {
      network: { request: vi.fn() },
      storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
      events: { portfolio: { onUpdateComplete } },
      logger,
    },
  } as unknown as AddonContext;

  return { ctx, routes, sidebarItems, sidebarRemove, disableCallbacks, unlisten, onUpdateComplete, logger };
}

describe("Addon registration (Wealthfolio 3.x runtime)", () => {
  let mock: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    mock = createMockContext();
  });

  it("uses the addon id from manifest.json as route namespace", () => {
    expect(ADDON_ID).toBe(manifest.id);
  });

  it("registers all routes inside the addon's own namespace", () => {
    enable(mock.ctx);

    expect(mock.routes.map((r) => r.path)).toEqual([IMPORT_ROUTE, SETTINGS_ROUTE]);
    for (const route of mock.routes) {
      expect(getRouteNamespace(route.path)).toBe(manifest.id);
    }
  });

  it("registers all sidebar items inside the addon's own namespace", () => {
    enable(mock.ctx);

    expect(mock.sidebarItems).toHaveLength(2);
    for (const item of mock.sidebarItems) {
      expect(getRouteNamespace(item.route ?? "")).toBe(manifest.id);
    }
  });

  it("does not register the legacy pre-3.x paths", () => {
    enable(mock.ctx);

    const paths = [...mock.routes.map((r) => r.path), ...mock.sidebarItems.map((i) => i.route)];
    expect(paths).not.toContain("/activities/import/ibkr-multi");
    expect(paths).not.toContain("/settings/ibkr-flex");
  });

  it("registers routes as plain components with unique ids", () => {
    enable(mock.ctx);

    const ids = mock.routes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const route of mock.routes) {
      expect(route.id).toBeTruthy();
      expect(typeof route.component).toBe("function");
      expect(route.render).toBeUndefined();
    }
  });

  it("links every sidebar item to a registered route", () => {
    enable(mock.ctx);

    const routePaths = new Set(mock.routes.map((r) => r.path));
    for (const item of mock.sidebarItems) {
      expect(routePaths.has(item.route ?? "")).toBe(true);
    }
  });

  it("uses sidebar icons from the curated host icon set", () => {
    enable(mock.ctx);

    for (const item of mock.sidebarItems) {
      expect(ADDON_ICON_NAMES).toContain(item.icon);
    }
  });

  it("registers the network broker as HTTP client", () => {
    enable(mock.ctx);
    expect(hasNetworkClient()).toBe(true);
  });

  it("subscribes to portfolio update events", async () => {
    enable(mock.ctx);
    await vi.waitFor(() => expect(mock.onUpdateComplete).toHaveBeenCalledTimes(1));
  });

  it("cleans up sidebar items, event listener and network client on disable", async () => {
    const { disable } = enable(mock.ctx);
    await vi.waitFor(() =>
      expect(mock.logger.trace).toHaveBeenCalledWith(expect.stringContaining("Registered portfolio update listener"))
    );

    disable();

    expect(mock.sidebarRemove).toHaveBeenCalledTimes(2);
    expect(mock.unlisten).toHaveBeenCalledTimes(1);
    expect(hasNetworkClient()).toBe(false);
  });

  it("registers cleanup via ctx.onDisable and runs it only once", async () => {
    const { disable } = enable(mock.ctx);
    await vi.waitFor(() => expect(mock.onUpdateComplete).toHaveBeenCalled());

    expect(mock.disableCallbacks).toHaveLength(1);
    mock.disableCallbacks[0]();
    disable();

    expect(mock.sidebarRemove).toHaveBeenCalledTimes(2);
  });
});
