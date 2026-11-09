/**
 * Manifest Tests
 *
 * Validates manifest.json against the installed @wealthfolio/addon-sdk so that
 * permission names match what the host enforces (e.g. events.onUpdateComplete,
 * not portfolio.onUpdateComplete) and the sandbox runtime requirements are met.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BASELINE_PERMISSION_CATEGORIES,
  HOST_DEPENDENCIES,
  PERMISSION_CATEGORIES,
} from "@wealthfolio/addon-sdk";
import manifest from "../../manifest.json";

const MIN_HOST_VERSION = "3.12.0";

/** True if semantic version a >= b (major.minor.patch, numeric parts only) */
function isVersionAtLeast(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

/** Hosts referenced as https:// URLs in a source file */
function readHttpsHosts(relativePath: string): string[] {
  const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  return [...source.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map((match) => match[1].toLowerCase());
}

describe("manifest.json", () => {
  it("declares only known permission categories", () => {
    const knownCategories = PERMISSION_CATEGORIES.map((category) => category.id);
    for (const permission of manifest.permissions) {
      expect(knownCategories).toContain(permission.category);
    }
  });

  it("does not declare baseline capabilities", () => {
    for (const permission of manifest.permissions) {
      expect(BASELINE_PERMISSION_CATEGORIES as readonly string[]).not.toContain(permission.category);
    }
  });

  it("declares only functions that exist in their category", () => {
    for (const permission of manifest.permissions) {
      const category = PERMISSION_CATEGORIES.find((c) => c.id === permission.category);
      for (const fn of permission.functions) {
        expect(category?.functions, `${permission.category}.${fn.name}`).toContain(fn.name);
      }
    }
  });

  it("grants the event used for auto-fetch", () => {
    const events = manifest.permissions.find((p) => p.category === "events");
    expect(events?.functions.map((f) => f.name)).toContain("onUpdateComplete");
  });

  it("requires a host with the sandbox runtime", () => {
    expect(isVersionAtLeast(manifest.sdkVersion, MIN_HOST_VERSION)).toBe(true);
    expect(isVersionAtLeast(manifest.minWealthfolioVersion, MIN_HOST_VERSION)).toBe(true);
  });

  it("declares host dependencies matching the SDK", () => {
    expect(manifest.hostDependencies).toEqual(HOST_DEPENDENCIES);
  });

  it("allows every external host the addon requests", () => {
    const requestedHosts = new Set([
      ...readHttpsHosts("../lib/flex-query-fetcher.ts"),
      ...readHttpsHosts("../lib/ticker-resolver.ts"),
    ]);
    expect(requestedHosts.size).toBeGreaterThan(0);
    for (const host of requestedHosts) {
      expect(manifest.network.allowedHosts).toContain(host);
    }
  });

  it("declares the network permission for brokered requests", () => {
    const network = manifest.permissions.find((p) => p.category === "network");
    expect(network?.functions.map((f) => f.name)).toContain("request");
  });
});
