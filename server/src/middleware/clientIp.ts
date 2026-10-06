import type { Context, Next } from "koa";

import { type TrustedProxies, resolveClientIp, trustedProxies } from "../config/ProxyConfig.js";

/**
 * Sets `ctx.ip` to the player's real address (issue #214): the
 * `CF-Connecting-IP` header only when the connection comes from a proxy in
 * `TRUSTED_PROXIES` (`config/ProxyConfig.ts`), otherwise the address that
 * connected. Every per-IP rate limit, the login and sign-up logs and the
 * Turnstile check read `ctx.ip`, so this is mounted first.
 *
 * Koa's own `app.proxy` would believe the header from anyone, so it stays off.
 *
 * @param {TrustedProxies} proxies - Who may name the client's IP; `TRUSTED_PROXIES` by default
 * @returns {Function} Koa middleware
 */
export const clientIp =
  (proxies: TrustedProxies = trustedProxies) =>
  (ctx: Context, next: Next) => {
    ctx.request.ip = resolveClientIp(ctx.req.socket?.remoteAddress, ctx.get("CF-Connecting-IP") || undefined, proxies);
    return next();
  };
