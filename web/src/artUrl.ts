import { ART_URL } from "./config";

/**
 * The address of a piece of game art (Cloudflare plan, 18 Nov 2026).
 *
 * Every picture, sound and language file the game server serves is written in
 * the code as a path on the page's own address (`/assets/...`), which Vercel
 * passes on to the server (`web/vercel.json` rewrites). With `VITE_ART_URL`
 * set, for example to `https://cdn.bymrevamped.com`, those paths are asked of
 * that address instead, so Cloudflare's cache answers them and Vercel no
 * longer counts each one.
 *
 * Only the server's art folders move. Anything else comes back unchanged: the
 * page's own files in `web/public` (`/portraits/...`, `/tribes/...`, `/ui/...`),
 * an address that is already whole (`https://...`, `//...`), `data:` and
 * `blob:` pictures. So passing an address through twice changes nothing.
 */

/** The game server's art folders: the paths Vercel rewrites to the server. */
const ART_PATH = /^\/(?:assets|gamestage|templates)\//;

/**
 * The origin to put in front of the art, from `VITE_ART_URL`: no trailing
 * slash, and empty unless it is a whole `http(s)://` address. A value without
 * one (`cdn.example.com`) would turn every picture into a broken relative
 * path, so it is ignored and the art stays where it was.
 *
 * @param {string | undefined} raw - The setting as given.
 * @returns {string} The origin, or "" for the page's own address.
 */
export const artBase = (raw: string | undefined): string => {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^/]+/i.test(value) ? value : "";
};

/**
 * The address of `path` on `base` (see {@link artUrl}); the pure part, for tests.
 *
 * @param {string} base - From {@link artBase}; "" leaves every path as it is.
 * @param {string} path - The art's path, e.g. `/assets/buildings/flinger/top.1.png`.
 * @returns {string} The address to ask for.
 */
export const joinArtUrl = (base: string, path: string): string =>
  base && ART_PATH.test(path) ? `${base}${path}` : path;

const BASE = artBase(ART_URL);

/**
 * Where to ask for a piece of game art: `/assets/x.png` becomes
 * `https://cdn.bymrevamped.com/assets/x.png` when `VITE_ART_URL` says so, and
 * stays `/assets/x.png` when it is not set.
 *
 * @param {string} path - The art's path on the page's own address.
 * @returns {string} The address to ask for.
 */
export const artUrl = (path: string): string => joinArtUrl(BASE, path);

/**
 * The path of an art address on the page's own address: the opposite of
 * {@link artUrl}, for code that tells pictures apart by folder.
 *
 * @param {string} url - An address {@link artUrl} may have made.
 * @returns {string} The path, e.g. `/assets/buildings/flinger/top.1.png`.
 */
export const artPath = (url: string): string =>
  BASE && url.startsWith(`${BASE}/`) ? url.slice(BASE.length) : url;
