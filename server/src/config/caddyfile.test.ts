import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { CLOUDFLARE_RANGES } from "./ProxyConfig.js";

/**
 * The front door (deploy/Caddyfile) and the game server must agree on who
 * Cloudflare is, and Caddy must hand on the player's address the safe way.
 * Caddy's own behaviour (the header believed only from Cloudflare's ranges)
 * was checked on the caddy:2.10.2-alpine image when this was written; these
 * tests keep the file from drifting.
 */

const caddyfile = readFileSync(new URL("../../deploy/Caddyfile", import.meta.url), "utf8");
const compose = readFileSync(new URL("../../docker-compose.prod.yml", import.meta.url), "utf8");

/** The Caddyfile without its comments. */
const directives = caddyfile
  .split("\n")
  .map((line) => line.replace(/#.*$/, "").trim())
  .filter(Boolean);

/** The site block that starts with `address {`, up to its closing brace at the left margin. */
const siteBlock = (address: string): string => {
  const start = caddyfile.indexOf(`\n${address} {`);
  expect(start).toBeGreaterThan(-1);
  return caddyfile.slice(start, caddyfile.indexOf("\n}", start));
};

describe("deploy/Caddyfile", () => {
  test("trusts exactly Cloudflare's ranges from ProxyConfig.ts", () => {
    const line = directives.find((text) => text.startsWith("trusted_proxies static "));
    expect(line).toBeDefined();
    expect(line!.split(/\s+/).slice(2)).toEqual(CLOUDFLARE_RANGES);
  });

  test("reads the player's address only from CF-Connecting-IP", () => {
    expect(directives).toContain("client_ip_headers CF-Connecting-IP");
  });

  test("hands on {client_ip}, never the visitor's own header or {remote_host}", () => {
    const handedOn = directives.filter((text) => text.startsWith("header_up CF-Connecting-IP"));
    expect(handedOn.length).toBe(3); // chat, API, art
    for (const text of handedOn) expect(text).toBe("header_up CF-Connecting-IP {client_ip}");
    expect(caddyfile).not.toContain("{remote_host}");
  });

  test("the art name serves only the three art folders", () => {
    const cdn = siteBlock("{$CDN_DOMAIN}");
    expect(cdn).toContain("@art path /assets/* /gamestage/* /templates/*");
    expect(cdn).toContain("handle @art {");
    expect(cdn).toContain("respond 404");
    expect(cdn).not.toContain("web:3010");
    expect(cdn.match(/reverse_proxy/g)?.length).toBe(1);
  });

  test("Caddy is given CDN_DOMAIN, and refuses to start without it", () => {
    expect(compose).toContain("CDN_DOMAIN: ${CDN_DOMAIN:?CDN_DOMAIN is not set in production.env}");
  });
});
