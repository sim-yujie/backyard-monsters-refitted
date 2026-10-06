import { BlockList, isIP } from "node:net";

/**
 * Which proxies may tell the server a player's real IP (issue #214):
 * `TRUSTED_PROXIES`.
 *
 * Cloudflare puts the visitor's address in the `CF-Connecting-IP` header. The
 * server used to believe that header from anyone, so a bot reaching the origin
 * directly could send a new address with every request and never hit a per-IP
 * limit (sign-up, login, the public reads). Now the header counts only when the
 * connection itself comes from a trusted proxy; any other request is keyed by
 * the address that actually connected.
 *
 * A comma-separated list of:
 * - `cloudflare` — Cloudflare's published ranges (below);
 * - an IP address, or a range such as `10.0.0.0/8` — for example a local nginx
 *   or the Docker gateway sitting between Cloudflare and the server.
 *
 * Unset or blank means `cloudflare`. `none` trusts no proxy, so the header is
 * never read: the right choice for a server players reach directly.
 *
 * Read once at import time, like `OWNER_SAVE_MODE` (`config/OwnerSaveConfig.ts`).
 */

/**
 * Cloudflare's ranges, from https://www.cloudflare.com/ips-v4 and /ips-v6
 * (checked 2026-10-06). They change rarely; when they do, update this list.
 */
export const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

export interface TrustedProxies {
  /** Whether a connection from this address may name the client's IP. */
  trusts: (address: string) => boolean;
  /** The entries that were understood, for the boot log. */
  entries: string[];
  /** Entries that are neither a keyword, an address nor a range; ignored. */
  rejected: string[];
}

/** "::ffff:1.2.3.4", an IPv4 address on an IPv6 socket, as plain "1.2.3.4". */
const unmapIPv4 = (address: string): string => address.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");

const family = (address: string): "ipv4" | "ipv6" | null => {
  const version = isIP(address);
  return version === 4 ? "ipv4" : version === 6 ? "ipv6" : null;
};

/** Adds one address or range to the list; false when it is neither. */
const addEntry = (list: BlockList, entry: string): boolean => {
  const [address, prefix, extra] = entry.split("/");
  const type = family(unmapIPv4(address));
  if (!type || extra !== undefined) return false;

  if (prefix === undefined) {
    list.addAddress(unmapIPv4(address), type);
    return true;
  }

  const bits = Number(prefix);
  const maxBits = type === "ipv4" ? 32 : 128;
  if (!/^\d+$/.test(prefix) || bits > maxBits) return false;

  list.addSubnet(unmapIPv4(address), bits, type);
  return true;
};

/**
 * Reads `TRUSTED_PROXIES`.
 *
 * @param {string | undefined} raw - The variable as set, if at all
 * @returns {TrustedProxies} Who may name the client's IP
 */
export const parseTrustedProxies = (raw: string | undefined): TrustedProxies => {
  const tokens = (raw?.trim() || "cloudflare")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  const list = new BlockList();
  const entries: string[] = [];
  const rejected: string[] = [];

  for (const token of tokens) {
    const keyword = token.toLowerCase();
    if (keyword === "none") continue;

    if (keyword === "cloudflare") {
      CLOUDFLARE_RANGES.forEach((range) => addEntry(list, range));
      entries.push("cloudflare");
    } else if (addEntry(list, token)) {
      entries.push(token);
    } else {
      rejected.push(token);
    }
  }

  const trusts = (address: string): boolean => {
    const plain = unmapIPv4(address);
    const type = family(plain);
    return type !== null && list.check(plain, type);
  };

  return { trusts, entries, rejected };
};

/**
 * The player's IP: the `CF-Connecting-IP` header when the connection comes from
 * a trusted proxy and the header holds one address, otherwise the address that
 * connected.
 *
 * @param {string | undefined} peer - The socket's remote address
 * @param {string | undefined} header - The `CF-Connecting-IP` header, if sent
 * @param {TrustedProxies} proxies - Who may name the client's IP
 * @returns {string} The address to key limits and logs on
 */
export const resolveClientIp = (peer: string | undefined, header: string | undefined, proxies: TrustedProxies): string => {
  const connected = unmapIPv4(peer ?? "");
  const named = unmapIPv4(header?.trim() ?? "");

  if (named && family(named) && proxies.trusts(connected)) return named;
  return connected;
};

export const trustedProxies: TrustedProxies = parseTrustedProxies(process.env.TRUSTED_PROXIES);
