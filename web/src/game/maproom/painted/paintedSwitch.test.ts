import { describe, expect, it } from "vitest";
import { MR2_LOOK_KEY, paintedMapOn } from "./paintedSwitch";

const store = (value: string | null) => ({ getItem: (key: string) => (key === MR2_LOOK_KEY ? value : null) });

describe("MR2_PAINTED_MAP on the client", () => {
  const base = { classic: false, search: "", store: store(null), dev: false };

  it("follows the server's flag", () => {
    expect(paintedMapOn({ ...base, serverFlag: 1 })).toBe(true);
    expect(paintedMapOn({ ...base, serverFlag: 0 })).toBe(false);
    expect(paintedMapOn({ ...base, serverFlag: undefined })).toBe(false);
  });

  it("Classic always keeps the tile map", () => {
    expect(paintedMapOn({ ...base, classic: true, serverFlag: 1 })).toBe(false);
    expect(paintedMapOn({ ...base, classic: true, serverFlag: 1, search: "?mr2look=on", dev: true })).toBe(false);
  });

  it("a browser can always turn it off", () => {
    expect(paintedMapOn({ ...base, serverFlag: 1, search: "?mr2look=off" })).toBe(false);
    expect(paintedMapOn({ ...base, serverFlag: 1, store: store("off") })).toBe(false);
  });

  it("turning it on by hand works only in a development build", () => {
    expect(paintedMapOn({ ...base, serverFlag: 0, search: "?mr2look=on" })).toBe(false);
    expect(paintedMapOn({ ...base, serverFlag: 0, search: "?mr2look=on", dev: true })).toBe(true);
    expect(paintedMapOn({ ...base, serverFlag: 0, store: store("on"), dev: true })).toBe(true);
  });
});
