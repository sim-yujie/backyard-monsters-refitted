import { describe, expect, test } from "bun:test";
import { corsSettings, isAllowedOrigin } from "./CorsConfig.js";

/** Which pages may read the server's answers (security audit 2026-10-29, L8). */

const PROD = {
  ENV: "production",
  WEB_URL: "https://play.bymrevamped.com",
  BASE_URL: "https://api.bymrevamped.com",
};

describe("CORS origins", () => {
  test("production: the web client and the server itself, nothing else", () => {
    const settings = corsSettings(PROD);
    expect(isAllowedOrigin("https://play.bymrevamped.com", settings)).toBe(true);
    expect(isAllowedOrigin("https://api.bymrevamped.com", settings)).toBe(true);

    expect(isAllowedOrigin("https://evil.example", settings)).toBe(false);
    expect(isAllowedOrigin("http://play.bymrevamped.com", settings)).toBe(false);
    expect(isAllowedOrigin("https://play.bymrevamped.com.evil.example", settings)).toBe(false);
    expect(isAllowedOrigin("http://localhost:5173", settings)).toBe(false);
    expect(isAllowedOrigin("null", settings)).toBe(false);
    expect(isAllowedOrigin(undefined, settings)).toBe(false);
    expect(isAllowedOrigin("", settings)).toBe(false);
  });

  test("CORS_ORIGINS adds more, and a path or a stray space does not matter", () => {
    const settings = corsSettings({ ...PROD, CORS_ORIGINS: " https://bymr-git-x.vercel.app/ , https://bymrevamped.com,not a url" });
    expect(isAllowedOrigin("https://bymr-git-x.vercel.app", settings)).toBe(true);
    expect(isAllowedOrigin("https://bymrevamped.com", settings)).toBe(true);
    expect([...settings.origins]).toHaveLength(4);
  });

  test("off production: any localhost or 127.0.0.1 port too", () => {
    const settings = corsSettings({ ENV: "local" });
    for (const origin of ["http://localhost:5173", "http://localhost:5312", "http://127.0.0.1:3021", "http://localhost"]) {
      expect([origin, isAllowedOrigin(origin, settings)]).toEqual([origin, true]);
    }
    expect(isAllowedOrigin("http://localhost.evil.example", settings)).toBe(false);
    expect(isAllowedOrigin("http://192.168.1.5:5173", settings)).toBe(false);
  });
});
