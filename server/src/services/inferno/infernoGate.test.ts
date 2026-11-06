import { describe, expect, test } from "bun:test";
import type { Context } from "koa";
import type { User } from "../../database/models/user.model.js";
import { BaseMode, BaseType } from "../../enums/Base.js";
import { INFERNO_MODES, INFERNO_SAVE_TYPES, refuseOldInferno, requireInfernoEnabled } from "./infernoGate.js";

const ctx = { path: "/base/load", ip: "127.0.0.1" } as Context;
const user = { userid: 1, username: "player" } as User;

describe("what is left of the Flash Inferno", () => {
  test("is refused with 403 infernoClosed, always", () => {
    try {
      refuseOldInferno(ctx, user, "load ibuild");
      throw new Error("expected a refusal");
    } catch (err) {
      expect((err as any).status).toBe(403);
      expect((err as any).data).toEqual({ reason: "infernoClosed" });
    }
  });

  test("every Inferno mode is gated, and no mode the web game loads", () => {
    const inferno = Object.values(BaseMode).filter((mode) => mode.startsWith("i"));
    expect([...INFERNO_MODES].sort()).toEqual(inferno.sort());
    for (const mode of [BaseMode.BUILD, BaseMode.VIEW, BaseMode.ATTACK, BaseMode.WMATTACK, BaseMode.WMVIEW, BaseMode.HELP]) {
      expect(INFERNO_MODES.has(mode)).toBe(false);
    }
  });

  test("only Inferno rows count as Inferno saves", () => {
    expect([...INFERNO_SAVE_TYPES].sort()).toEqual([BaseType.INFERNO, BaseType.INFERNO_TRIBE].sort());
  });
});

describe("the new Inferno's switch", () => {
  test("off, a new route is refused with 403 infernoOff", () => {
    try {
      requireInfernoEnabled(false);
      throw new Error("expected a refusal");
    } catch (err) {
      expect((err as any).status).toBe(403);
      expect((err as any).data).toEqual({ reason: "infernoOff" });
    }
  });

  test("on, the route runs", () => {
    expect(() => requireInfernoEnabled(true)).not.toThrow();
  });
});
