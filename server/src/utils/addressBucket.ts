import { isIP } from "node:net";

const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** An IPv6 address's eight groups, written out (`::` filled in, leading zeros dropped). */
const ipv6Groups = (ip: string): string[] => {
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const front = head ? head.split(":") : [];
  const back = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
  // An IPv4 tail (`::1.2.3.4`) takes two groups; it is past any prefix used here.
  const missing = ip.includes("::") ? Math.max(8 - front.length - back.length, 0) : 0;
  return [...front, ...Array<string>(missing).fill("0"), ...back].map((group) => group.replace(/^0+(?=.)/, ""));
};

/**
 * The address a per-address limit counts under (security audit 2026-10-29,
 * L2). An IPv4 address is itself. An IPv6 address is its /64: one home or
 * phone line is usually handed a whole /64, so counting each of its
 * addresses apart would let one connection try again from a fresh address
 * every time. An IPv4 address written as IPv6 (`::ffff:1.2.3.4`) is the IPv4
 * address.
 *
 * @param ip - The client's address (`ctx.ip`).
 * @returns `1.2.3.4`, or `2001:db8:1:2::/64`; anything else unchanged.
 */
export const addressBucket = (ip: string): string => {
  const mapped = ip.match(MAPPED_IPV4);
  if (mapped) return mapped[1]!;
  if (isIP(ip) !== 6) return ip;
  return `${ipv6Groups(ip).slice(0, 4).join(":")}::/64`;
};

/**
 * The network an address belongs to, for a limit one machine should not fill
 * by itself: an IPv4 /24 or an IPv6 /48 (a site's usual allocation).
 *
 * @param ip - The client's address (`ctx.ip`).
 * @returns `1.2.3.0/24`, or `2001:db8:1::/48`; anything else unchanged.
 */
export const networkBucket = (ip: string): string => {
  const ipv4 = ip.match(MAPPED_IPV4)?.[1] ?? ip;
  if (isIP(ipv4) === 4) return `${ipv4.split(".").slice(0, 3).join(".")}.0/24`;
  if (isIP(ip) !== 6) return ip;
  return `${ipv6Groups(ip).slice(0, 3).join(":")}::/48`;
};
