import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Context } from "koa";

/**
 * The "Report a bug" routes (`submitBugReport.ts`) with a fake database and
 * mail server: a report is saved, then emailed with its pictures; a failed
 * email still leaves it saved; the daily cap per account and, signed out,
 * per IP; the Turnstile check on signed-out reports; the size and type
 * checks on the pictures; and the words the player must write.
 */

type Row = Record<string, unknown> & { id: number; created_at: Date };

let rows: Row[];
let mails: Record<string, any>[];
let mailFails: boolean;

/** Answers the store's three statements (`services/bugReports/bugReports.ts`). */
const em = {
  fork: () => em,
  execute: async (sql: string, params: unknown[] = []) => {
    const text = sql.trim();
    if (text.startsWith("SELECT count(*)")) {
      const column = text.includes("WHERE userid = ?") ? "userid" : "ip_hash";
      const [key, since] = params as [unknown, Date];
      return [{ count: String(rows.filter((row) => row[column] === key && row.created_at > since).length) }];
    }
    if (text.startsWith("INSERT INTO bym.bug_report")) {
      const [userid, username, contact_email, ip_hash, message, game_version, screen, device, user_agent, screen_size, errors, screenshot, screenshot_type, picture, picture_type] = params;
      const row: Row = {
        id: rows.length + 1,
        userid, username, contact_email, ip_hash, message, game_version, screen, device, user_agent, screen_size,
        errors: JSON.parse(errors as string),
        screenshot, screenshot_type, picture, picture_type,
        emailed_at: null,
        created_at: new Date(),
      };
      rows.push(row);
      return [{ id: String(row.id) }];
    }
    if (text.startsWith("UPDATE bym.bug_report SET emailed_at")) {
      const row = rows.find((one) => one.id === params[0]);
      if (row) row.emailed_at = new Date();
      return [];
    }
    throw new Error(`unexpected SQL: ${text}`);
  },
};

mock.module("../../server.js", () => ({ postgres: { em } }));
mock.module("../../config/MailConfig.js", () => ({
  transporter: {
    sendMail: async (mail: Record<string, any>) => {
      if (mailFails) throw new Error("mail server down");
      mails.push(mail);
    },
  },
}));
mock.module("../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { submitBugReportController, submitGuestBugReportController } = await import("./submitBugReport.js");
const { submitBugReport, hashIp } = await import("../../services/bugReports/bugReports.js");
const { BUG_REPORTS_PER_DAY, DEFAULT_BUG_REPORT_EMAIL } = await import("../../config/BugReportConfig.js");

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const dataUrl = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString("base64")}`;

const PLAYER = { userid: 42, username: "Tester", email: "tester@example.com" };

const report = (extra: Record<string, unknown> = {}) => ({
  message: "  The hatchery button does nothing.  ",
  gameVersion: "2.0.0-beta.4",
  screen: "yard",
  device: "phone",
  userAgent: "Mozilla/5.0 (test)",
  screenSize: "390x844",
  errors: JSON.stringify(["TypeError: x is undefined", "Failed to load texture"]),
  screenshot: dataUrl("image/jpeg", JPEG),
  ...extra,
});

const ctxOf = (body: unknown, { user = PLAYER as unknown, ip = "203.0.113.7" } = {}) =>
  ({ authUser: user, request: { body }, ip, status: 0, body: undefined }) as unknown as Context & { body: any };

const signedIn = async (body: unknown, user: unknown = PLAYER) => {
  const ctx = ctxOf(body, { user });
  await submitBugReportController(ctx, async () => {});
  return ctx;
};

const signedOut = async (body: unknown, ip = "203.0.113.7") => {
  const ctx = ctxOf(body, { user: undefined, ip });
  await submitGuestBugReportController(ctx, async () => {});
  return ctx;
};

/** The error a call throws, so its status and reason can be checked. */
const refusal = async (call: () => Promise<unknown>): Promise<any> => {
  try {
    await call();
  } catch (err) {
    return err;
  }
  throw new Error("expected a refusal");
};

/** Lets the background email finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const saved = { sandbox: process.env.DEV_SANDBOX, secret: process.env.TURNSTILE_SECRET_KEY, to: process.env.BUG_REPORT_EMAIL };
const realFetch = globalThis.fetch;

beforeEach(() => {
  rows = [];
  mails = [];
  mailFails = false;
  // Off, so the email goes to the (fake) mail server rather than the log.
  process.env.DEV_SANDBOX = "false";
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.BUG_REPORT_EMAIL;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of [
    ["DEV_SANDBOX", saved.sandbox],
    ["TURNSTILE_SECRET_KEY", saved.secret],
    ["BUG_REPORT_EMAIL", saved.to],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("a signed-in report", () => {
  test("is saved with everything the client sent, then emailed with the screenshot", async () => {
    const ctx = await signedIn(report({ picture: dataUrl("image/png", PNG) }));
    expect(ctx.status).toBe(200);
    expect(ctx.body).toMatchObject({ error: 0, id: 1 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userid: 42,
      username: "Tester",
      contact_email: null,
      ip_hash: null,
      message: "The hatchery button does nothing.",
      game_version: "2.0.0-beta.4",
      screen: "yard",
      device: "phone",
      user_agent: "Mozilla/5.0 (test)",
      screen_size: "390x844",
      errors: ["TypeError: x is undefined", "Failed to load texture"],
      screenshot_type: "image/jpeg",
      picture_type: "image/png",
    });
    expect(Buffer.compare(rows[0].screenshot as Buffer, JPEG)).toBe(0);

    await settle();
    expect(mails).toHaveLength(1);
    const [mail] = mails;
    expect(mail.to).toBe(DEFAULT_BUG_REPORT_EMAIL);
    expect(mail.replyTo).toBe("tester@example.com");
    expect(mail.subject).toBe("Bug report #1: The hatchery button does nothing.");
    expect(mail.text).toContain("Player: Tester (user 42)");
    expect(mail.text).toContain("- TypeError: x is undefined");
    expect(mail.attachments.map((one: any) => [one.filename, one.contentType])).toEqual([
      ["screenshot-1.jpg", "image/jpeg"],
      ["picture-1.png", "image/png"],
    ]);
    expect(rows[0].emailed_at).toBeInstanceOf(Date);
  });

  test("goes to BUG_REPORT_EMAIL when it is set", async () => {
    process.env.BUG_REPORT_EMAIL = "bugs@example.org";
    await signedIn(report());
    await settle();
    expect(mails[0].to).toBe("bugs@example.org");
  });

  test("stays saved when the email fails, and is not marked emailed", async () => {
    mailFails = true;
    const ctx = await signedIn(report());
    expect(ctx.status).toBe(200);
    expect(rows).toHaveLength(1);

    const result = await submitBugReport(em as any, { ...rowOf(), userid: 43 }, null);
    expect(await result.emailed).toBe(false);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.emailed_at === null)).toBe(true);
  });

  test("is not emailed with DEV_SANDBOX on: it goes to the log", async () => {
    process.env.DEV_SANDBOX = "true";
    await signedIn(report());
    await settle();
    expect(mails).toHaveLength(0);
    expect(rows[0].emailed_at).toBeInstanceOf(Date);
  });

  test(`is refused after ${BUG_REPORTS_PER_DAY} in a day, and nothing more is saved`, async () => {
    for (let i = 0; i < BUG_REPORTS_PER_DAY; i++) await signedIn(report());
    const err = await refusal(() => signedIn(report()));
    expect(err.status).toBe(429);
    expect(err.data).toEqual({ reason: "bugReportLimit" });
    expect(err.message).toContain("try again tomorrow");
    expect(rows).toHaveLength(BUG_REPORTS_PER_DAY);

    // Another player still can.
    await signedIn(report(), { ...PLAYER, userid: 7 });
    expect(rows).toHaveLength(BUG_REPORTS_PER_DAY + 1);
  });

  test("reports older than a day do not count", async () => {
    for (let i = 0; i < BUG_REPORTS_PER_DAY; i++) await signedIn(report());
    for (const row of rows) row.created_at = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect((await signedIn(report())).status).toBe(200);
  });

  test.each([
    ["no words", { message: undefined }],
    ["too few words", { message: "  hi " }],
    ["too many words", { message: "x".repeat(2001) }],
  ])("is refused with %s", async (_, extra) => {
    const err = await refusal(() => signedIn(report(extra)));
    expect(err.status).toBe(400);
    expect(err.data).toEqual({ reason: "invalidBugReport", field: "message" });
    expect(rows).toHaveLength(0);
  });

  test("clips what the client gathered instead of refusing it", async () => {
    await signedIn(
      report({
        userAgent: "u".repeat(900),
        device: "toaster",
        screen: 12,
        errors: JSON.stringify([...Array.from({ length: 30 }, (_, i) => `error ${i}`), { not: "text" }, "e".repeat(5000)]),
      })
    );
    const [row] = rows;
    expect((row.user_agent as string).length).toBe(512);
    expect(row.device).toBe("");
    expect(row.screen).toBe("");
    const errors = row.errors as string[];
    expect(errors).toHaveLength(20);
    expect(errors.at(-1)!.length).toBe(1000);
    expect(errors[0]).toBe("error 11");
  });

  test("takes the errors as an array too", async () => {
    await signedIn(report({ errors: ["one", "two"] }));
    expect(rows[0].errors).toEqual(["one", "two"]);
  });

  test("may come without any picture", async () => {
    await signedIn(report({ screenshot: "" }));
    expect(rows[0]).toMatchObject({ screenshot: null, screenshot_type: null, picture: null });
    await settle();
    expect(mails[0].attachments).toEqual([]);
    expect(mails[0].text).toContain("Screenshot: none");
  });
});

describe("pictures", () => {
  test("a picture that is not really an image is refused", async () => {
    const err = await refusal(() => signedIn(report({ picture: dataUrl("image/png", Buffer.from("<svg>not a png</svg>")) })));
    expect(err.status).toBe(400);
    expect(err.data).toEqual({ reason: "invalidBugReport", field: "picture" });
    expect(rows).toHaveLength(0);
  });

  test.each(["data:image/svg+xml;base64,PHN2Zz4=", "data:text/html;base64,PGI+", "https://example.com/x.png", "not base64"])(
    "%s is refused",
    async (picture) => {
      const err = await refusal(() => signedIn(report({ picture })));
      expect(err.data).toEqual({ reason: "invalidBugReport", field: "picture" });
    }
  );

  test("a picture over 3 MB is refused", async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(3_000_001)]);
    const err = await refusal(() => signedIn(report({ picture: dataUrl("image/jpeg", big) })));
    expect(err.status).toBe(400);
    expect(err.message).toBe("The picture is too big. The largest is 3 MB.");
    expect(rows).toHaveLength(0);
  });

  test("a screenshot over 1.5 MB is refused", async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(1_500_001)]);
    const err = await refusal(() => signedIn(report({ screenshot: dataUrl("image/jpeg", big) })));
    expect(err.message).toBe("The screenshot is too big. The largest is 1.5 MB.");
  });

  test("a WebP picture is kept as one", async () => {
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
    await signedIn(report({ picture: dataUrl("image/webp", webp) }));
    expect(rows[0].picture_type).toBe("image/webp");
  });
});

describe("a signed-out report (the login screen)", () => {
  test("needs an email for the reply, which the email is sent back to", async () => {
    const err = await refusal(() => signedOut(report()));
    expect(err.status).toBe(400);
    expect(err.data).toEqual({ reason: "invalidBugReport", field: "email" });

    const ctx = await signedOut(report({ email: " Someone@Example.com " }));
    expect(ctx.status).toBe(200);
    expect(rows[0]).toMatchObject({ userid: null, username: null, contact_email: "someone@example.com", ip_hash: hashIp("203.0.113.7") });
    expect(rows[0].ip_hash).not.toContain("203.0.113.7");
    await settle();
    expect(mails[0].replyTo).toBe("someone@example.com");
    expect(mails[0].text).toContain("Player: Signed out");
  });

  test(`is refused after ${BUG_REPORTS_PER_DAY} a day from one IP address`, async () => {
    const body = report({ email: "someone@example.com" });
    for (let i = 0; i < BUG_REPORTS_PER_DAY; i++) await signedOut(body);
    const err = await refusal(() => signedOut(body));
    expect(err.status).toBe(429);
    expect(err.data).toEqual({ reason: "bugReportLimit" });
    expect(rows).toHaveLength(BUG_REPORTS_PER_DAY);

    expect((await signedOut(body, "198.51.100.1")).status).toBe(200);
  });

  describe("with a Turnstile secret key", () => {
    let checks: URLSearchParams[];
    let verdict: Record<string, unknown> | "down";

    beforeEach(() => {
      process.env.TURNSTILE_SECRET_KEY = "test-secret";
      checks = [];
      verdict = { success: true };
      globalThis.fetch = (async (_url: unknown, init: { body: URLSearchParams }) => {
        checks.push(init.body);
        if (verdict === "down") throw new Error("unreachable");
        return new Response(JSON.stringify(verdict), { status: 200 });
      }) as unknown as typeof fetch;
    });

    test("a passing token saves the report", async () => {
      const ctx = await signedOut(report({ email: "someone@example.com", turnstileToken: "good" }));
      expect(ctx.status).toBe(200);
      expect(checks[0].get("response")).toBe("good");
      expect(checks[0].get("remoteip")).toBe("203.0.113.7");
      expect(rows).toHaveLength(1);
    });

    test("a missing or failing token saves nothing", async () => {
      expect((await refusal(() => signedOut(report({ email: "someone@example.com" })))).data).toEqual({ reason: "botCheckFailed" });
      verdict = { success: false, "error-codes": ["invalid-input-response"] };
      expect((await refusal(() => signedOut(report({ email: "someone@example.com", turnstileToken: "bad" })))).data).toEqual({
        reason: "botCheckFailed",
      });
      expect(rows).toHaveLength(0);
    });

    test("Cloudflare out of reach is a 503 and saves nothing", async () => {
      verdict = "down";
      const err = await refusal(() => signedOut(report({ email: "someone@example.com", turnstileToken: "good" })));
      expect(err.status).toBe(503);
      expect(rows).toHaveLength(0);
    });

    test("a signed-in report needs no token", async () => {
      expect((await signedIn(report())).status).toBe(200);
      expect(checks).toHaveLength(0);
    });
  });
});

describe("routes", () => {
  const routes = readFileSync(new URL("../../app.routes.ts", import.meta.url), "utf8");

  test("the signed-in route needs a signed-in player; both are rate limited and not echoed to the log", () => {
    expect(routes).toContain(
      'router.post("/api/:apiVersion/bugreport", apiVersion, verifyUserAuth, bugReportLimiter, submitBugReportController);'
    );
    expect(routes).toContain('router.post("/api/:apiVersion/bugreport/guest", apiVersion, bugReportLimiter, submitGuestBugReportController);');
  });
});

/** A checked report as the service takes it. */
const rowOf = () => ({
  userid: 42,
  username: "Tester",
  contactEmail: null,
  ipHash: null,
  message: "Something broke",
  gameVersion: "",
  screen: "",
  device: "",
  userAgent: "",
  screenSize: "",
  errors: [],
  screenshot: null,
  picture: null,
});
