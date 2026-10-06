import { describe, expect, test } from "bun:test";
import { startupRefusals } from "./StartupSafety.js";

/**
 * A server that looks like production refuses to start with development
 * settings (issue #319); a local server is left alone.
 */

const STRONG = "k".repeat(48);

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
    expect(startupRefusals({ ENV: "production", SECRET_KEY: STRONG, DB_PASSWORD: "a-real-one" })).toEqual([]);
    expect(
      startupRefusals({ ENV: "production", NODE_ENV: "production", SECRET_KEY: STRONG, DB_PASSWORD: "x" })
    ).toEqual([]);
  });

  test("NODE_ENV=production with ENV=local or unset is refused", () => {
    const local = startupRefusals({ NODE_ENV: "production", ENV: "local", SECRET_KEY: STRONG });
    expect(local).toEqual([expect.stringContaining("ENV=production")]);
    expect(startupRefusals({ NODE_ENV: "production", SECRET_KEY: STRONG })).toHaveLength(1);
  });

  test("production refuses a short or example SECRET_KEY", () => {
    expect(startupRefusals({ ENV: "production", SECRET_KEY: "k".repeat(31) })).toEqual([
      expect.stringContaining("shorter"),
    ]);
    expect(startupRefusals({ ENV: "production", SECRET_KEY: "changeme" }).length).toBeGreaterThan(0);
  });

  test("production refuses the example DB password, quoted or not", () => {
    expect(startupRefusals({ ENV: "production", SECRET_KEY: STRONG, DB_PASSWORD: "dev12345" })).toHaveLength(1);
    expect(startupRefusals({ ENV: "production", SECRET_KEY: STRONG, DB_PASSWORD: "'dev12345'" })).toHaveLength(1);
  });
});
