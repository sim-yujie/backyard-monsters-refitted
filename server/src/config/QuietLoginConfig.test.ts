import { describe, expect, spyOn, test } from "bun:test";

import { logger } from "../utils/logger.js";
import { quietLoginOn } from "./QuietLoginConfig.js";

describe("QUIET_LOGIN", () => {
  test("is off when unset or set to anything but 1, on or true", () => {
    expect(quietLoginOn({})).toBe(false);
    expect(quietLoginOn({ QUIET_LOGIN: "" })).toBe(false);
    expect(quietLoginOn({ QUIET_LOGIN: "0" })).toBe(false);
    expect(quietLoginOn({ QUIET_LOGIN: "off" })).toBe(false);
    expect(quietLoginOn({ QUIET_LOGIN: "yes" })).toBe(false);
  });

  test("is on for 1, on or true on a local server", () => {
    expect(quietLoginOn({ QUIET_LOGIN: "1" })).toBe(true);
    expect(quietLoginOn({ QUIET_LOGIN: " on " })).toBe(true);
    expect(quietLoginOn({ QUIET_LOGIN: "TRUE", ENV: "local", NODE_ENV: "development" })).toBe(true);
  });

  test("is refused on a production server, with one warning in the log", () => {
    const warn = spyOn(logger, "warn").mockImplementation((() => undefined) as never);
    expect(quietLoginOn({ QUIET_LOGIN: "1", NODE_ENV: "production" })).toBe(false);
    expect(quietLoginOn({ QUIET_LOGIN: "1", ENV: "production" })).toBe(false);
    expect(quietLoginOn({ QUIET_LOGIN: "on", ENV: "production", NODE_ENV: "production" })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
