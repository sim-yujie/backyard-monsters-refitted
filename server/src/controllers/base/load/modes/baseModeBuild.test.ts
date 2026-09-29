import { describe, expect, mock, test } from "bun:test";
import type { User } from "../../../../database/models/user.model.js";

/**
 * An owner's build load names a base id that has no save (#191): a clean
 * `404 baseNotFound` rather than an unhandled error and a 500.
 */

mock.module("../../../../server.js", () => ({
  postgres: { em: { findOne: async () => null, persist: () => {}, flush: async () => {} } },
}));

const { baseModeBuild } = await import("./baseModeBuild.js");

const user = {
  userid: 2505,
  save: { baseid: "3510", attackid: 0, attacks: [] },
} as unknown as User;

describe("baseModeBuild", () => {
  test("an unknown base id is a 404, not a 500", async () => {
    const caught = await baseModeBuild(user, "99000001250250").catch((error: unknown) => error);
    expect(caught).toMatchObject({ status: 404, data: { reason: "baseNotFound" } });
  });
});
