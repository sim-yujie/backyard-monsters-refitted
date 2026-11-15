import { request, type FullConfig } from "@playwright/test";
import { assertSafeSettings, settings } from "./settings";

/**
 * Makes one fresh account per worker on the check's own server, each starting
 * on the maxed sandbox yard (the server runs with DEV_SANDBOX=true), so every
 * window has something to list. `zz_` marks a test account
 * (server/src/services/stats/realPlayers.ts). The accounts reach the workers
 * through LAYOUT_ACCOUNTS.
 */
const PASSWORD = "Layout-check-1";

const register = async (index: number): Promise<{ email: string; password: string }> => {
  const api = await request.newContext({ baseURL: settings.serverUrl });
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const digits = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
      const username = `zz_lay${digits}`;
      const email = `${username}.${index}@layout-check.test`;
      const response = await api.post(`/api/${settings.apiVersion}/player/register`, {
        form: {
          username,
          email,
          password: PASSWORD,
          termsAccepted: "true",
          sandboxStart: "true",
        },
      });
      if (response.ok()) return { email, password: PASSWORD };
      const text = await response.text();
      if (/usernameTaken|emailTaken/.test(text)) continue;
      throw new Error(
        `Registering the layout-check account failed: HTTP ${response.status()} ${text.slice(0, 300)}`,
      );
    }
    throw new Error("Registering the layout-check account failed: every name tried was taken.");
  } finally {
    await api.dispose();
  }
};

export default async function globalSetup(config: FullConfig): Promise<void> {
  assertSafeSettings();
  const workers = Math.max(1, config.workers);
  const accounts = [];
  for (let index = 0; index < workers; index += 1) accounts.push(await register(index));
  process.env["LAYOUT_ACCOUNTS"] = JSON.stringify(accounts);
}
