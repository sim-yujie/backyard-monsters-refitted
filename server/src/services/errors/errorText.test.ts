import { describe, expect, test } from "bun:test";

import { cleanMessage, cleanPlace, cleanStack, ERROR_TEXT_LIMITS, errorFingerprint, errorShape, scrubText } from "./errorText.js";

describe("cleaning error text (errorText.ts)", () => {
  test("emails, IP addresses, tokens and long hex are replaced", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjF9.c2lnbmF0dXJlX2hlcmU";
    expect(scrubText("mail jo.bloggs+x@mail.co.uk failed")).toBe("mail [email] failed");
    expect(scrubText(`token ${jwt} bad`)).toBe("token [token] bad");
    expect(scrubText("header Bearer abc.def-123")).toBe("header Bearer [token]");
    expect(scrubText("from 203.0.113.7 and 2001:db8:0:0:0:0:2:1")).toBe("from [ip] and [ip]");
    expect(scrubText(`key ${"a1".repeat(16)} end`)).toBe("key [hex] end");
    expect(scrubText("player 123456 at x=40")).toBe("player 123456 at x=40");
  });

  test("a message is one line, cut to size, never empty", () => {
    expect(cleanMessage("TypeError:\n   x is\tundefined")).toBe("TypeError: x is undefined");
    expect(cleanMessage("   ")).toBe("(no message)");
    const long = cleanMessage("x".repeat(2000));
    expect(long).toHaveLength(ERROR_TEXT_LIMITS.messageMax);
    expect(long.endsWith("…")).toBe(true);
  });

  test("a place loses the site's address; a stack keeps its lines", () => {
    expect(cleanPlace("https://play.example.com/static/index-Dh3HKT6K.js:1:2345")).toBe("/static/index-Dh3HKT6K.js:1:2345");
    expect(cleanPlace("GET /api/v1/bm/base/load")).toBe("GET /api/v1/bm/base/load");
    expect(cleanStack("Error: a\n  at f (x.js:1:2)\n")).toBe("Error: a\n  at f (x.js:1:2)");
  });

  test("errors that differ only by numbers, ids or build hash have one fingerprint", () => {
    expect(errorShape("Cannot read 'hp' of building 42 at index-Dh3HKT6K.js:1:999")).toBe(
      "cannot read 'hp' of building # at index.js:#:#"
    );
    const a = errorFingerprint("browser", "No building 42", "/static/index-Dh3HKT6K.js:1:200");
    const b = errorFingerprint("browser", "No building 7", "/static/index-ZZ9xxYY1.js:1:31");
    expect(a).toBe(b);
    expect(errorFingerprint("server", "No building 42", "/static/index-Dh3HKT6K.js:1:200")).not.toBe(a);
    expect(errorFingerprint("browser", "Other thing", "/static/index.js")).not.toBe(a);
  });
});
