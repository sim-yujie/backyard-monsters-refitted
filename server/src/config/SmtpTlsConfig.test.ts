import { describe, expect, test } from "bun:test";

import { parseSmtpTls } from "./SmtpTlsConfig.js";

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
