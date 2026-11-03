import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The game's two routes for a warning or mute pop-up need a sign-in, and act
 * only on the signed-in player's own notices (`ctx.authUser`): read off the
 * sources, as `controllers/admin/routes.test.ts` does.
 */

const routes = readFileSync(join(import.meta.dir, "../../app.routes.ts"), "utf8");
const controller = readFileSync(join(import.meta.dir, "notice.ts"), "utf8");

describe("the moderation notice routes", () => {
  test("need a sign-in", () => {
    const lines = routes.split("\n").filter((line) => line.includes("/bm/moderation/notice"));
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toContain("apiVersion, verifyUserAuth,");
  });

  test("read and close only the signed-in player's notices", () => {
    expect(controller).toContain("pendingNotice(postgres.em.fork(), ctx.authUser.userid)");
    expect(controller).toContain("markNoticeSeen(postgres.em.fork(), ctx.authUser.userid, id)");
  });
});
