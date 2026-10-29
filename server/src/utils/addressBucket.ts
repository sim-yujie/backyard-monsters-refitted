import { isIP } from "node:net";

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
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1]!;
  if (isIP(ip) !== 6) return ip;

  const [head, tail = ""] = ip.toLowerCase().split("::");
  const front = head ? head.split(":") : [];
  const back = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
  // An IPv4 tail (`::1.2.3.4`) takes two groups; it is past the /64 either way.
  const missing = 8 - front.length - back.length;
  const groups = ip.includes("::") ? [...front, ...Array(Math.max(missing, 0)).fill("0"), ...back] : front;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
};
