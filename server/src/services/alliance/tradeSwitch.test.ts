import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Context } from "koa";
import { allianceTradeEnabled } from "../../config/AllianceConfig.js";
import { requireTradeOn, TRADE_OFF_REASON, tradeSwitchGate } from "./tradeSwitch.js";

/** Trading's switch (owner 11 Nov 2026: off for beta 7, polished for beta 8). */

const saved = process.env.ALLIANCE_TRADE_ENABLED;
afterEach(() => {
  if (saved === undefined) delete process.env.ALLIANCE_TRADE_ENABLED;
  else process.env.ALLIANCE_TRADE_ENABLED = saved;
});

const refusalOf = (run: () => unknown) => {
  try {
    run();
  } catch (err) {
    return err as { status?: number; data?: { reason?: string }; message?: string };
  }
  return null;
};

describe("ALLIANCE_TRADE_ENABLED", () => {
  test("is off unless on or true", () => {
    expect(allianceTradeEnabled({})).toBe(false);
    expect(allianceTradeEnabled({ ALLIANCE_TRADE_ENABLED: "" })).toBe(false);
    expect(allianceTradeEnabled({ ALLIANCE_TRADE_ENABLED: "off" })).toBe(false);
    expect(allianceTradeEnabled({ ALLIANCE_TRADE_ENABLED: "1" })).toBe(false);
    expect(allianceTradeEnabled({ ALLIANCE_TRADE_ENABLED: "on" })).toBe(true);
    expect(allianceTradeEnabled({ ALLIANCE_TRADE_ENABLED: " TRUE " })).toBe(true);
  });
});

describe("switch off: trade routes refuse", () => {
  test("requireTradeOn refuses with 403 and reason trade_off while off", () => {
    const refusal = refusalOf(() => requireTradeOn({}));
    expect(refusal?.status).toBe(403);
    expect(refusal?.data?.reason).toBe(TRADE_OFF_REASON);
    expect(refusal?.message).toContain("switched off");
    expect(refusalOf(() => requireTradeOn({ ALLIANCE_TRADE_ENABLED: "on" }))).toBeNull();
  });

  test("the gate stops the request before the controller while off", async () => {
    delete process.env.ALLIANCE_TRADE_ENABLED;
    let reached = false;
    const next = async () => {
      reached = true;
    };
    const caught = await tradeSwitchGate({} as Context, next).then(
      () => null,
      (err: unknown) => err as { status?: number; data?: { reason?: string } },
    );
    expect(reached).toBe(false);
    expect(caught?.status).toBe(403);
    expect(caught?.data?.reason).toBe(TRADE_OFF_REASON);
  });

  test("the gate lets the request through while on", async () => {
    process.env.ALLIANCE_TRADE_ENABLED = "on";
    let reached = false;
    await tradeSwitchGate({} as Context, async () => {
      reached = true;
    });
    expect(reached).toBe(true);
  });

  test("every /alliance/trade route sits behind the gate", () => {
    const routes = readFileSync(new URL("../../app.routes.ts", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => /router\.(get|post|put|delete|patch)\(\s*"\/alliance\/trade/.test(line));
    // view, post, cancel, accept, send
    expect(routes.length).toBe(5);
    for (const line of routes) {
      const gate = line.indexOf("tradeSwitchGate");
      expect(gate).toBeGreaterThan(line.indexOf("verifyUserAuth"));
      expect(gate).toBeLessThan(line.lastIndexOf(","));
    }
  });
});
