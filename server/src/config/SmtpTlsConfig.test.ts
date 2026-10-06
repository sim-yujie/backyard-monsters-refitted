import { describe, expect, test } from "bun:test";

import { parseSmtpEncryption, parseSmtpTls } from "./SmtpTlsConfig.js";

describe("SMTP_INSECURE_TLS (issue #215)", () => {
  test("checks the certificate when unset or set to anything but true", () => {
    for (const raw of [undefined, "", "false", "yes", "1"]) {
      expect(parseSmtpTls(raw, "local")).toEqual({ rejectUnauthorized: true, insecureIgnored: false });
    }
  });

  test("true turns the check off off production, in any case", () => {
    expect(parseSmtpTls("true", "local")).toEqual({ rejectUnauthorized: false, insecureIgnored: false });
    expect(parseSmtpTls(" TRUE ", undefined)).toEqual({ rejectUnauthorized: false, insecureIgnored: false });
  });

  test("is ignored on production, which always checks", () => {
    expect(parseSmtpTls("true", "production")).toEqual({ rejectUnauthorized: true, insecureIgnored: true });
    expect(parseSmtpTls(undefined, "production")).toEqual({ rejectUnauthorized: true, insecureIgnored: false });
  });
});

describe("SMTP_ALLOW_PLAINTEXT (issue #320)", () => {
  test("production and port 465 use TLS from the start", () => {
    expect(parseSmtpEncryption(undefined, 465, "production")).toEqual({
      secure: true,
      requireTLS: false,
      plaintextIgnored: false,
    });
    expect(parseSmtpEncryption(undefined, 465, "local").secure).toBe(true);
  });

  test("any other connection must upgrade with STARTTLS", () => {
    for (const raw of [undefined, "", "false", "yes"]) {
      expect(parseSmtpEncryption(raw, 587, "local")).toEqual({ secure: false, requireTLS: true, plaintextIgnored: false });
    }
    expect(parseSmtpEncryption(undefined, 25, undefined).requireTLS).toBe(true);
  });

  test("true allows plain text off production only", () => {
    expect(parseSmtpEncryption(" True ", 1025, "local")).toEqual({ secure: false, requireTLS: false, plaintextIgnored: false });
    expect(parseSmtpEncryption("true", 587, "production")).toEqual({
      secure: true,
      requireTLS: false,
      plaintextIgnored: true,
    });
  });
});
