import { describe, expect, it } from "bun:test";
import {
  hookProviders,
  providersForInitTarget,
  providersForUninstallTarget,
} from "../hook-providers/index.js";

describe("hook provider registry", () => {
  it("maps init targets to providers while preserving --all as Claude plus Codex", () => {
    expect(providersForInitTarget("claude")).toEqual(["claude"]);
    expect(providersForInitTarget("codex")).toEqual(["codex"]);
    expect(providersForInitTarget("hermes")).toEqual(["hermes"]);
    expect(providersForInitTarget("all")).toEqual(["claude", "codex"]);
  });

  it("maps uninstall --all to every provider metadata surface", () => {
    expect(providersForUninstallTarget("all")).toEqual(["claude", "codex", "hermes"]);
  });

  it("declares canonical hook commands for all supported providers", () => {
    expect(hookProviders.claude.command).toBe("agentlog hook");
    expect(hookProviders.codex.command).toBe("agentlog hook --source codex");
    expect(hookProviders.hermes.command).toBe("agentlog hook --source hermes");
  });
});
