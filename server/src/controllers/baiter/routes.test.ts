import { beforeEach, describe, expect, mock, test } from "bun:test";
import { RULES_VERSION } from "../../services/defences/rulesVersion.js";

/**
 * `POST /baiter/test/start` (beta 9 #4) is an attack start the server fights
 * again for the inviter's Results, so a page with older battle rules is
 * refused with "New version" before the ticket is given (patch 8.4,
 * `services/base/combat/rulesStamp.ts`).
 */

let started: unknown[];

mock.module("../../server.js", () => ({ postgres: { em: {} }, redis: {} }));
mock.module("../../services/baiter/baiterRunStore.js", () => ({ redisRunTickets: {} }));
mock.module("../../services/baiter/baiterTests.js", () => {
  const answer = async () => ({ error: 0 });
  return {
    baiterRefusedErr: () => new Error("refused"),
    cancelAnswer: answer,
    finishAnswer: answer,
    inviteAnswer: answer,
    testAnswer: answer,
    testsAnswer: answer,
    startAnswer: async (_em: unknown, _user: unknown, body: unknown) => {
      started.push(body);
      return { error: 0, token: "t" };
    },
  };
});

const { mountBaiterRoutes } = await import("./routes.js");

type Handler = (ctx: Record<string, unknown>, next: () => Promise<void>) => Promise<void>;
const posts = new Map<string, Handler>();
mountBaiterRoutes({
  get: () => undefined,
  post: (path: string, ...handlers: Handler[]) => posts.set(path, handlers[handlers.length - 1]!),
} as never);

const start = async (body: Record<string, unknown>) => {
  const ctx: Record<string, unknown> = {
    request: { body },
    authUser: { userid: 2505, username: "tester" },
    ip: "127.0.0.1",
    status: 0,
  };
  await posts.get("/api/:apiVersion/baiter/test/start")!(ctx, async () => {});
  return ctx;
};

describe("POST /baiter/test/start: the battle-rules stamp", () => {
  beforeEach(() => {
    started = [];
  });

  test("a page with older battle rules, or none, is refused with New version before the ticket", async () => {
    for (const rules of ["0ba3fde8701104af", undefined]) {
      const refusal = await start({ inviter: 7, rules }).then(
        () => null,
        (caught: { data?: unknown }) => caught.data
      );
      expect(refusal).toEqual({ reason: "newVersion" });
    }
    expect(started).toEqual([]);
  });

  test("a page on the server's rules starts the test", async () => {
    const ctx = await start({ inviter: 7, rules: RULES_VERSION });
    expect(started).toEqual([{ inviter: 7, rules: RULES_VERSION }]);
    expect(ctx.body).toEqual({ error: 0, token: "t" });
  });
});
