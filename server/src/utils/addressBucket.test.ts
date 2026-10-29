import { describe, expect, test } from "bun:test";
import { addressBucket, networkBucket } from "./addressBucket.js";

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

/** The account-wide sign-in count takes at most 10 from each network (security audit 2026-10-29, L2). */
describe("networkBucket", () => {
  test("an IPv4 address is its /24, also when written as IPv6", () => {
    expect(networkBucket("203.0.113.9")).toBe("203.0.113.0/24");
    expect(networkBucket("203.0.113.250")).toBe("203.0.113.0/24");
    expect(networkBucket("::ffff:203.0.113.9")).toBe("203.0.113.0/24");
    expect(networkBucket("203.0.114.9")).toBe("203.0.114.0/24");
  });

  test("an IPv6 address is its /48, however it is written", () => {
    for (const ip of ["2001:db8:5:1::1", "2001:0db8:0005:ffff:a:b:c:d", "2001:DB8:5::", "2001:db8:5::9"]) {
      expect([ip, networkBucket(ip)]).toEqual([ip, "2001:db8:5::/48"]);
    }
    expect(networkBucket("2001:db8:6:1::1")).toBe("2001:db8:6::/48");
    expect(networkBucket("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(networkBucket("::1")).toBe("0:0:0::/48");
  });

  test("anything that is not an address is left as it is", () => {
    expect(networkBucket("")).toBe("");
    expect(networkBucket("unknown")).toBe("unknown");
  });
});
