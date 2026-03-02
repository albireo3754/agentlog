import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { isVersionAtLeast, MIN_CLI_VERSION, resolveCliBin } from "../obsidian-cli.js";

describe("isVersionAtLeast", () => {
  it("returns true when versions are equal", () => {
    expect(isVersionAtLeast("1.12.4", "1.12.4")).toBe(true);
  });

  it("returns true when version is greater (patch)", () => {
    expect(isVersionAtLeast("1.12.5", "1.12.4")).toBe(true);
  });

  it("returns true when version is greater (minor)", () => {
    expect(isVersionAtLeast("1.13.0", "1.12.4")).toBe(true);
  });

  it("returns true when version is greater (major)", () => {
    expect(isVersionAtLeast("2.0.0", "1.12.4")).toBe(true);
  });

  it("returns false when version is less (patch)", () => {
    expect(isVersionAtLeast("1.12.3", "1.12.4")).toBe(false);
  });

  it("returns false when version is less (minor)", () => {
    expect(isVersionAtLeast("1.11.9", "1.12.4")).toBe(false);
  });

  it("returns false when version is less (major)", () => {
    expect(isVersionAtLeast("0.99.99", "1.12.4")).toBe(false);
  });

  it("handles versions with different segment counts", () => {
    expect(isVersionAtLeast("1.12", "1.12.0")).toBe(true);
    expect(isVersionAtLeast("1.12.4", "1.12")).toBe(true);
  });

  it("handles single-segment versions", () => {
    expect(isVersionAtLeast("2", "1")).toBe(true);
    expect(isVersionAtLeast("1", "2")).toBe(false);
  });
});

describe("MIN_CLI_VERSION", () => {
  it("is set to 1.12.4", () => {
    expect(MIN_CLI_VERSION).toBe("1.12.4");
  });
});

describe("resolveCliBin — OBSIDIAN_BIN override", () => {
  const originalOverride = process.env.OBSIDIAN_BIN;

  beforeEach(() => {
    delete process.env.OBSIDIAN_BIN;
  });

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.OBSIDIAN_BIN;
    } else {
      process.env.OBSIDIAN_BIN = originalOverride;
    }
  });

  it("returns OBSIDIAN_BIN when set", () => {
    process.env.OBSIDIAN_BIN = "/custom/obsidian";
    expect(resolveCliBin()).toBe("/custom/obsidian");
  });

  it("trims OBSIDIAN_BIN value", () => {
    process.env.OBSIDIAN_BIN = "  /custom/obsidian  ";
    expect(resolveCliBin()).toBe("/custom/obsidian");
  });

  it("prioritizes OBSIDIAN_BIN over previously cached auto resolution", () => {
    // Warm cache with auto resolution path (found or not-found).
    resolveCliBin();

    process.env.OBSIDIAN_BIN = "/override/obsidian";
    expect(resolveCliBin()).toBe("/override/obsidian");
  });
});
