import { afterEach, describe, expect, test } from "bun:test";

import { infernoConfig, infernoEnabled } from "./InfernoConfig.js";

describe("INFERNO_ENABLED", () => {
  const saved = process.env.INFERNO_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.INFERNO_ENABLED;
    else process.env.INFERNO_ENABLED = saved;
  });

  test("is off when unset or set to anything but on or true", () => {
    expect(infernoEnabled({})).toBe(false);
    expect(infernoEnabled({ INFERNO_ENABLED: "" })).toBe(false);
    expect(infernoEnabled({ INFERNO_ENABLED: "off" })).toBe(false);
    expect(infernoEnabled({ INFERNO_ENABLED: "yes" })).toBe(false);
  });

  test("is on for on or true, in any case and with spaces", () => {
    expect(infernoEnabled({ INFERNO_ENABLED: "on" })).toBe(true);
    expect(infernoEnabled({ INFERNO_ENABLED: " TRUE " })).toBe(true);
  });

  test("the config reads it on each use", () => {
    process.env.INFERNO_ENABLED = "on";
    expect(infernoConfig.enabled).toBe(true);
    process.env.INFERNO_ENABLED = "off";
    expect(infernoConfig.enabled).toBe(false);
  });
});
