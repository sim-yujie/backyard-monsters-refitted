import { describe, expect, test } from "bun:test";

import { cacheControlFor } from "./corsCacheControlSetup.js";

describe("cacheControlFor", () => {
  test("keeps a picture a week, versioned or not", () => {
    expect(cacheControlFor("/assets/monsters/pokey-anim@2x.png", true)).toBe("public, max-age=604800");
    expect(cacheControlFor("/assets/buildings/townhall.JPG", true)).toBe("public, max-age=604800");
  });

  test("keeps any other static file an hour", () => {
    expect(cacheControlFor("/assets/sounds/music/yard-theme.mp3", true)).toBe("public, max-age=3600");
  });

  test("keeps nothing from the API, or from a local server", () => {
    expect(cacheControlFor("/api/v2.0.0/bm/getnewmap.png", true)).toBe("no-cache, no-store, must-revalidate");
    expect(cacheControlFor("/assets/monsters/pokey-anim@2x.png", false)).toBe("no-cache, no-store, must-revalidate");
  });
});
