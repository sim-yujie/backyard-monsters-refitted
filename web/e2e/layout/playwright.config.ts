import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { assertSafeSettings, settings } from "./settings";

/**
 * The layout check (owner, 15 Nov 2026): every window opened in Safari's
 * engine (Playwright WebKit) on phones, iPads and desktops, failing when a
 * window is cut off or its list is empty. The rules it enforces are in
 * .claude/skills/layout-rules/SKILL.md; the screens are in profiles.ts.
 *
 * It starts its own game server (bun, ../server) and its own built web page
 * (vite build + vite preview), on ports away from the owner's game, and
 * needs Postgres and Redis running with a throwaway database that has the
 * game's schema.
 *
 * Run it on a developer PC (one browser, WebKit, hidden):
 *   1. once: a database for it, from nothing
 *        docker exec bymr-database createdb -U postgres bym_layout
 *        cd server && DB_NAME=bym_layout bun run db:init
 *   2. once per Playwright version: cd web && npx playwright install webkit
 *   3. each run:
 *        cd web && LAYOUT_DB_NAME=bym_layout npm run test:layout
 *      (on the WSL PC prefix PATH="$HOME/.bun/bin:$PATH" NODE_OPTIONS=--no-webstorage)
 *   Narrow it with LAYOUT_PROFILES=ipad-side-bars,phone-side; LAYOUT_SHOTS=all
 *   keeps a picture of every case. Results: e2e/layout/report/index.html
 *   (npx playwright show-report e2e/layout/report).
 *
 * CI runs the same command in the `layout` job of .github/workflows/ci.yml.
 */

assertSafeSettings();

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "../..");
const server = resolve(web, "../server");
const ci = Boolean(process.env["CI"]);
const home = process.env["HOME"] ?? "";

export default defineConfig({
  testDir: here,
  testMatch: /.*\.spec\.ts$/,
  outputDir: resolve(here, "results"),
  globalSetup: resolve(here, "globalSetup.ts"),
  // A window test clicks through up to eight tabs, each polled until settled.
  timeout: 150_000,
  expect: { timeout: 10_000 },
  // Each spec file is one group of screens sharing a signed-in page per
  // screen; files spread over the workers, one account per worker.
  fullyParallel: false,
  workers: Number(process.env["LAYOUT_WORKERS"] ?? (ci ? 2 : 1)),
  // No retries: a retry reboots a whole screen (minutes), and a layout fault
  // that only shows sometimes should be seen, not hidden.
  retries: 0,
  // Under the CI job's 60 minutes, so the report is still written and uploaded.
  globalTimeout: 40 * 60_000,
  reporter: [
    ["list"],
    ["html", { outputFolder: resolve(here, "report"), open: "never" }],
    ...(ci ? ([["github"]] as const) : []),
  ],
  use: {
    browserName: "webkit",
    actionTimeout: 10_000,
    // No sound from test browsers (owner, 15 Nov 2026): point WebKit at a sound server that does not exist.
    launchOptions: { env: { ...process.env, PULSE_SERVER: "unix:/nonexistent/no-sound" } },
  },
  projects: [{ name: "webkit", use: { browserName: "webkit" } }],
  webServer: [
    {
      name: "game server",
      command: "bun src/server.ts",
      cwd: server,
      url: `${settings.serverUrl}/api/${settings.apiVersion}/player/signupoptions`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: process.env["LAYOUT_SERVER_LOG"] === "1" ? "pipe" : "ignore",
      env: {
        // Bun does not let server/.env override anything set here.
        PATH: `${home}/.bun/bin:${process.env["PATH"] ?? ""}`,
        ENV: "local",
        PORT: String(settings.serverPort),
        BASE_URL: "http://localhost",
        CHAT_WS_PORT: String(settings.chatPort),
        CHAT_POLICY_PORTS: String(settings.chatPort),
        CHAT_WS_HOST: `localhost:${settings.chatPort}`,
        DB_NAME: settings.dbName,
        REDIS_URL: settings.redisUrl,
        SECRET_KEY:
          process.env["SECRET_KEY"] || "layout-check-only-secret-key-not-for-production",
        // Straight into the yard with no pop-ups, on the maxed sandbox yard.
        QUIET_LOGIN: "1",
        DEV_SANDBOX: "true",
        INFERNO_ENABLED: process.env["INFERNO_ENABLED"] ?? "on",
        USE_VERSION_MANAGEMENT: "disabled",
        // Background sweeps a short test run does not need.
        ATTACK_FINALISER_SWEEP: "off",
        RETENTION_SWEEP: "off",
        ALLIANCE_PROGRESS: "off",
        DASHBOARD_STATS: "off",
      },
    },
    {
      name: "web page",
      // A built page loads in one go; the dev server would send every module
      // separately on each of the many page loads. `vite preview` uses the
      // dev proxy (vite.config.ts) to reach the game server.
      command: `npx vite build && npx vite preview --port ${settings.webPort} --strictPort`,
      cwd: web,
      url: settings.webUrl,
      timeout: 300_000,
      reuseExistingServer: false,
      env: { VITE_PROXY_TARGET: settings.serverUrl },
    },
  ],
});
