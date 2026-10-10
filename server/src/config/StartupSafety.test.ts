import { describe, expect, test } from "bun:test";
import { startupRefusals } from "./StartupSafety.js";

/**
 * A server that looks like production refuses to start with development
 * settings (issue #319); a local server is left alone.
 */

const STRONG = "k".repeat(48);

/** Everything else a production server needs, set to real-looking values. */
const READY = {
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-secret",
  SMTP_HOST: "smtp.resend.com",
  SMTP_PORT: "465",
  SMTP_USER: "resend",
  SMTP_PASSWORD: "re_real_key",
  WEB_URL: "https://play.bymr.example.org",
  BASE_URL: "https://api.bymr.example.org",
  CHAT_WS_HOST: "wss://api.bymr.example.org/chat",
  MAIL_FROM: "BYMR <no-reply@bymr.example.org>",
};

describe("startupRefusals", () => {
  test("a local server starts with any SECRET_KEY and the example DB password", () => {
    expect(startupRefusals({ ENV: "local", SECRET_KEY: "short-local-key", DB_PASSWORD: "'dev12345'" })).toEqual([]);
  });

  test("any server refuses a missing SECRET_KEY", () => {
    expect(startupRefusals({ ENV: "local" })).toHaveLength(1);
    expect(startupRefusals({ ENV: "local", SECRET_KEY: "  " })).toHaveLength(1);
    expect(startupRefusals({ ENV: "local", SECRET_KEY: "''" })).toHaveLength(1);
  });

  test("a production server with good settings starts", () => {
    expect(startupRefusals({ ...READY, ENV: "production", SECRET_KEY: STRONG, DB_PASSWORD: "a-real-one" })).toEqual([]);
    expect(
      startupRefusals({ ...READY, ENV: "production", NODE_ENV: "production", SECRET_KEY: STRONG, DB_PASSWORD: "x" })
    ).toEqual([]);
  });

  test("NODE_ENV=production with ENV=local or unset is refused", () => {
    const local = startupRefusals({ ...READY, NODE_ENV: "production", ENV: "local", SECRET_KEY: STRONG });
    expect(local).toEqual([expect.stringContaining("ENV=production")]);
    expect(startupRefusals({ ...READY, NODE_ENV: "production", SECRET_KEY: STRONG })).toHaveLength(1);
  });

  test("production refuses a short or example SECRET_KEY", () => {
    expect(startupRefusals({ ...READY, ENV: "production", SECRET_KEY: "k".repeat(31) })).toEqual([
      expect.stringContaining("shorter"),
    ]);
    expect(startupRefusals({ ENV: "production", SECRET_KEY: "changeme" }).length).toBeGreaterThan(0);
  });

  test("production refuses the example DB password, quoted or not", () => {
    expect(startupRefusals({ ...READY, ENV: "production", SECRET_KEY: STRONG, DB_PASSWORD: "dev12345" })).toHaveLength(1);
    expect(startupRefusals({ ...READY, ENV: "production", SECRET_KEY: STRONG, DB_PASSWORD: "'dev12345'" })).toHaveLength(1);
  });

  test("production refuses a missing Turnstile key or mail server", () => {
    const base = { ...READY, ENV: "production", SECRET_KEY: STRONG, DB_PASSWORD: "x" };
    expect(startupRefusals({ ...base, TURNSTILE_SECRET_KEY: "" })).toEqual([
      expect.stringContaining("TURNSTILE_SECRET_KEY is not set"),
    ]);
    expect(startupRefusals({ ...base, TURNSTILE_SECRET_KEY: undefined })).toHaveLength(1);
    expect(startupRefusals({ ...base, SMTP_HOST: " ", SMTP_PASSWORD: "" })).toEqual([
      expect.stringContaining("SMTP_HOST"),
      expect.stringContaining("SMTP_PASSWORD"),
    ]);
    expect(startupRefusals({ ...base, WEB_URL: "" })).toEqual([expect.stringContaining("WEB_URL")]);
  });

  test("production refuses values left as production.env.example has them", () => {
    const base = { ...READY, ENV: "production", SECRET_KEY: STRONG, DB_PASSWORD: "x" };
    expect(startupRefusals({ ...base, DB_PASSWORD: "FILL IN" })).toEqual([expect.stringContaining("DB_PASSWORD")]);
    expect(startupRefusals({ ...base, ACME_EMAIL: "FILL IN" })).toEqual([expect.stringContaining("ACME_EMAIL")]);
    expect(startupRefusals({ ...base, WEB_URL: "https://play.EXAMPLE.com" })).toEqual([
      expect.stringContaining("WEB_URL"),
    ]);
    expect(
      startupRefusals({
        ...base,
        CHAT_WS_HOST: "wss://api.EXAMPLE.com/chat",
        MAIL_FROM: "BYMR <no-reply@EXAMPLE.com>",
      })
    ).toHaveLength(2);
  });

  test("a local server needs none of the production settings", () => {
    expect(startupRefusals({ ENV: "local", SECRET_KEY: "k", WEB_URL: "https://play.EXAMPLE.com" })).toEqual([]);
  });
});
