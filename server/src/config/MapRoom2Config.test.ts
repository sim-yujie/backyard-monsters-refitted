import { describe, expect, it } from "bun:test";
import { mr2PaintedMapFor, mr2PaintedMapMode } from "./MapRoom2Config.js";

describe("MR2_PAINTED_MAP", () => {
  it("is off unless set", () => {
    expect(mr2PaintedMapMode({})).toBe("off");
    expect(mr2PaintedMapMode({ MR2_PAINTED_MAP: "nonsense" })).toBe("off");
    expect(mr2PaintedMapFor(2503, {})).toBe(false);
  });

  it("on gives it to everyone", () => {
    expect(mr2PaintedMapMode({ MR2_PAINTED_MAP: "on" })).toBe("on");
    expect(mr2PaintedMapFor(2503, { MR2_PAINTED_MAP: "true" })).toBe(true);
  });

  it("staff gives it only to the listed accounts", () => {
    const env = { MR2_PAINTED_MAP: " Staff ", MR2_STAFF_USER_IDS: "7, 2503" };
    expect(mr2PaintedMapMode(env)).toBe("staff");
    expect(mr2PaintedMapFor(2503, env)).toBe(true);
    expect(mr2PaintedMapFor(25, env)).toBe(false);
    expect(mr2PaintedMapFor("2503", env)).toBe(false);
  });

  it("staff falls back to the admin list", () => {
    expect(mr2PaintedMapFor(7, { MR2_PAINTED_MAP: "staff", ADMIN_USER_IDS: "7" })).toBe(true);
    expect(mr2PaintedMapFor(7, { MR2_PAINTED_MAP: "staff" })).toBe(false);
  });
});
