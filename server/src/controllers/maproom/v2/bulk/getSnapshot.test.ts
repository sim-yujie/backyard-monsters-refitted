import { describe, expect, test } from "bun:test";
import type { Context } from "koa";
import { getSnapshot } from "./getSnapshot.js";

/**
 * `POST /worldmapv2/snapshot`, switched off while the fog of war is on
 * (issue #330): the whole-world base feed it used to serve is exactly what
 * fog of war exists to stop. Always refuses, regardless of query params.
 */

describe("getSnapshot", () => {
  test("always refuses with a 404, whatever the request carries", async () => {
    const ctx = { request: { body: { since: "123", format: "full" } } } as unknown as Context;

    const thrown = await getSnapshot(ctx, async () => {}).catch((caught: unknown) => caught);

    expect(thrown).toMatchObject({ status: 404, message: "This feed is switched off while Map Room 2's fog of war is on." });
  });
});
