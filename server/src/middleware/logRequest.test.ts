import { describe, expect, test } from "bun:test";
import { withoutSecrets } from "./logRequest.js";

describe("logRequest's body echo", () => {
  test("hides passwords and tokens, keeps everything else", () => {
    expect(
      withoutSecrets({ email: "p@example.com", password: "hunter22!", token: "eyJ...", turnstileToken: "x", x: 1 })
    ).toEqual({ email: "p@example.com", password: "[hidden]", token: "[hidden]", turnstileToken: "[hidden]", x: 1 });
  });
});
