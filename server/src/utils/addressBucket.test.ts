import { describe, expect, test } from "bun:test";
import { addressBucket } from "./addressBucket.js";

/** Per-address limits count an IPv6 address by its /64 (security audit 2026-10-29, L2). */
describe("addressBucket", () => {
  test("an IPv4 address is itself, also when written as IPv6", () => {
    expect(addressBucket("203.0.113.9")).toBe("203.0.113.9");
    expect(addressBucket("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(addressBucket("::FFFF:203.0.113.9")).toBe("203.0.113.9");
  });

  test("an IPv6 address is its /64, however it is written", () => {
    const bucket = "2001:db8:1:2::/64";
    for (const ip of [
      "2001:db8:1:2::1",
      "2001:0db8:0001:0002:ffff:ffff:ffff:ffff",
      "2001:DB8:1:2:a:b:c:d",
      "2001:db8:1:2::",
    ]) {
      expect([ip, addressBucket(ip)]).toEqual([ip, bucket]);
    }
    expect(addressBucket("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
    expect(addressBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(addressBucket("::1")).toBe("0:0:0:0::/64");
  });

  test("anything that is not an address is left as it is", () => {
    expect(addressBucket("")).toBe("");
    expect(addressBucket("unknown")).toBe("unknown");
  });
});
