import { describe, expect, test } from "bun:test";

import { CLOUDFLARE_RANGES, parseTrustedProxies, resolveClientIp } from "./ProxyConfig.js";

describe("TRUSTED_PROXIES", () => {
  test("trusts Cloudflare's ranges when unset or blank (issue #214)", () => {
    for (const raw of [undefined, "", "  "]) {
      const proxies = parseTrustedProxies(raw);
      expect(proxies.entries).toEqual(["cloudflare"]);
      expect(proxies.trusts("173.245.48.10")).toBe(true);
      expect(proxies.trusts("2606:4700::6810:84e5")).toBe(true);
      expect(proxies.trusts("203.0.113.7")).toBe(false);
      expect(proxies.trusts("127.0.0.1")).toBe(false);
    }
  });

  test("covers every published range at both ends", () => {
    const proxies = parseTrustedProxies("cloudflare");
    for (const range of CLOUDFLARE_RANGES.filter((range) => !range.includes(":"))) {
      const [base] = range.split("/");
      expect(proxies.trusts(base)).toBe(true);
    }
    expect(proxies.trusts("104.23.255.255")).toBe(true);
    expect(proxies.trusts("104.28.0.0")).toBe(false);
  });

  test("none trusts nobody, not even Cloudflare", () => {
    const proxies = parseTrustedProxies("none");
    expect(proxies.entries).toEqual([]);
    expect(proxies.trusts("173.245.48.10")).toBe(false);
  });

  test("takes addresses and ranges alongside the keyword", () => {
    const proxies = parseTrustedProxies(" Cloudflare , 127.0.0.1, 172.16.0.0/12, ::1 ");
    expect(proxies.entries).toEqual(["cloudflare", "127.0.0.1", "172.16.0.0/12", "::1"]);
    expect(proxies.trusts("127.0.0.1")).toBe(true);
    expect(proxies.trusts("::ffff:127.0.0.1")).toBe(true);
    expect(proxies.trusts("172.17.0.1")).toBe(true);
    expect(proxies.trusts("::1")).toBe(true);
    expect(proxies.trusts("127.0.0.2")).toBe(false);
  });

  test("ignores and reports what is not an address or range", () => {
    const proxies = parseTrustedProxies("localhost, 10.0.0.0/33, 1.2.3.4/x, 10.0.0.0/8/1, 10.0.0.0/8");
    expect(proxies.rejected).toEqual(["localhost", "10.0.0.0/33", "1.2.3.4/x", "10.0.0.0/8/1"]);
    expect(proxies.entries).toEqual(["10.0.0.0/8"]);
    expect(proxies.trusts("10.1.2.3")).toBe(true);
  });
});

describe("resolveClientIp", () => {
  const cloudflare = parseTrustedProxies("cloudflare");

  test("believes CF-Connecting-IP from Cloudflare", () => {
    expect(resolveClientIp("162.158.1.1", "198.51.100.4", cloudflare)).toBe("198.51.100.4");
    expect(resolveClientIp("::ffff:162.158.1.1", " 2001:db8::1 ", cloudflare)).toBe("2001:db8::1");
  });

  test("ignores the header from anyone else, so a faked one dodges nothing", () => {
    expect(resolveClientIp("203.0.113.7", "198.51.100.4", cloudflare)).toBe("203.0.113.7");
    expect(resolveClientIp("::ffff:203.0.113.7", "198.51.100.4", cloudflare)).toBe("203.0.113.7");
  });

  test("ignores a header that is not one address", () => {
    expect(resolveClientIp("162.158.1.1", "198.51.100.4, 10.0.0.1", cloudflare)).toBe("162.158.1.1");
    expect(resolveClientIp("162.158.1.1", "not-an-ip", cloudflare)).toBe("162.158.1.1");
    expect(resolveClientIp("162.158.1.1", "", cloudflare)).toBe("162.158.1.1");
    expect(resolveClientIp("162.158.1.1", undefined, cloudflare)).toBe("162.158.1.1");
  });

  test("never reads the header when no proxy is trusted", () => {
    expect(resolveClientIp("162.158.1.1", "198.51.100.4", parseTrustedProxies("none"))).toBe("162.158.1.1");
  });

  test("is empty, not a crash, when the socket has no address", () => {
    expect(resolveClientIp(undefined, "198.51.100.4", cloudflare)).toBe("");
  });
});
