import { describe, it, expect } from "bun:test";
import { Errors, formatError, toJsonError } from "../errors.js";

describe("Errors", () => {
  it("VAULT_NOT_FOUND includes path in message", () => {
    const err = Errors.VAULT_NOT_FOUND("/some/path");
    expect(err.code).toBe("VAULT_NOT_FOUND");
    expect(err.message).toContain("/some/path");
    expect(err.fix).toBeTruthy();
  });

  it("VAULT_NOT_OBSIDIAN includes path in message", () => {
    const err = Errors.VAULT_NOT_OBSIDIAN("/my/vault");
    expect(err.code).toBe("VAULT_NOT_OBSIDIAN");
    expect(err.message).toContain("/my/vault");
    expect(err.fix).toContain("agentlog init");
    expect(err.docs).toBeTruthy();
  });

  it("CONFIG_NOT_FOUND has correct code", () => {
    const err = Errors.CONFIG_NOT_FOUND();
    expect(err.code).toBe("CONFIG_NOT_FOUND");
    expect(err.fix).toContain("agentlog init");
  });

  it("HOOK_NOT_REGISTERED has correct code", () => {
    const err = Errors.HOOK_NOT_REGISTERED();
    expect(err.code).toBe("HOOK_NOT_REGISTERED");
    expect(err.fix).toContain("agentlog init");
  });

  it("CLI_NOT_FOUND has correct code", () => {
    const err = Errors.CLI_NOT_FOUND();
    expect(err.code).toBe("CLI_NOT_FOUND");
  });

  it("APP_NOT_RESPONDING has correct code", () => {
    const err = Errors.APP_NOT_RESPONDING();
    expect(err.code).toBe("APP_NOT_RESPONDING");
  });

  it("PROMPT_REQUIRED has correct code", () => {
    const err = Errors.PROMPT_REQUIRED();
    expect(err.code).toBe("PROMPT_REQUIRED");
    expect(err.fix).toContain("agentlog codex-debug");
  });
});

describe("formatError", () => {
  it("returns human-readable string with Error and Fix prefix", () => {
    const err = Errors.CONFIG_NOT_FOUND();
    const out = formatError(err);
    expect(out).toMatch(/^Error: /);
    expect(out).toContain("Fix:");
  });

  it("includes the message and fix", () => {
    const err = Errors.VAULT_NOT_FOUND("/test/path");
    const out = formatError(err);
    expect(out).toContain(err.message);
    expect(out).toContain(err.fix);
  });
});

describe("toJsonError", () => {
  it("returns object with status error and all error fields", () => {
    const err = Errors.HOOK_NOT_REGISTERED();
    const json = toJsonError(err) as Record<string, unknown>;
    expect(json.status).toBe("error");
    expect(json.code).toBe("HOOK_NOT_REGISTERED");
    expect(json.message).toBe(err.message);
    expect(json.fix).toBe(err.fix);
  });
});
