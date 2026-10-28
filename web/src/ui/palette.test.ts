import { describe, expect, it } from "vitest";

import { pickPalette } from "@/ui/palette";

describe("pickPalette", () => {
  it("takes the palette named in the address over the remembered one", () => {
    expect(pickPalette("?palette=sticker", "toolshed")).toBe("sticker");
  });

  it("falls back to the remembered palette", () => {
    expect(pickPalette("", "charcoal")).toBe("charcoal");
  });

  it("goes back to the default for an unknown or 'default' palette", () => {
    expect(pickPalette("?palette=default", "toolshed")).toBeNull();
    expect(pickPalette("?palette=neon", null)).toBeNull();
    expect(pickPalette("", "neon")).toBeNull();
  });
});
