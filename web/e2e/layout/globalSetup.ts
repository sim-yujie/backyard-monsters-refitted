import { request, type FullConfig } from "@playwright/test";
import { assertSafeSettings, settings } from "./settings";

/**
 * Makes one fresh account per worker on the check's own server, each starting
 * on the maxed sandbox yard (the server runs with DEV_SANDBOX=true), so every
 * window has something to list. `zz_` marks a test account
 * (server/src/services/stats/realPlayers.ts). The accounts reach the workers
 * through LAYOUT_ACCOUNTS. One more account, LAYOUT_FRIEND, is the friend
 * the friend's-yard check visits (friendYard.ts).
 */
const PASSWORD = "Layout-check-1";

interface Account {
  readonly email: string;
  readonly password: string;
  readonly username: string;
}

const register = async (index: number): Promise<Account> => {
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
      if (response.ok()) return { email, password: PASSWORD, username };
      const text = await response.text();
      if (/usernameTaken|emailTaken/.test(text)) continue;
      // Three sign-ups a minute outside production (registerLimiter): with
      // two workers and their friend that is all of them, so a quick re-run waits.
      if (response.status() === 429) {
        await new Promise((done) => setTimeout(done, 61_000));
        continue;
      }
      throw new Error(
        `Registering the layout-check account failed: HTTP ${response.status()} ${text.slice(0, 300)}`,
      );
    }
    throw new Error("Registering the layout-check account failed: every name tried was taken.");
  } finally {
    await api.dispose();
  }
};

/** A session for one account, over the API. */
const signIn = async (account: Account): Promise<{ token: string; userId: number }> => {
  const api = await request.newContext({ baseURL: settings.serverUrl });
  try {
    const response = await api.post(`/api/${settings.apiVersion}/player/getinfo`, {
      form: { email: account.email, password: account.password, sessionType: "game" },
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const token = body["token"];
    const userId = body["userId"];
    if (!response.ok() || typeof token !== "string" || typeof userId !== "number")
      throw new Error(`Sign-in for ${account.email} failed: HTTP ${response.status()}`);
    return { token, userId };
  } finally {
    await api.dispose();
  }
};

/**
 * Loads the account's own yard once, as the game does on its first start: a
 * yard is built on the first load, and a friend with none cannot be visited.
 */
const buildYard = async (session: { token: string; userId: number }): Promise<void> => {
  const api = await request.newContext({ baseURL: settings.serverUrl });
  try {
    const response = await api.post("/base/load", {
      headers: { Authorization: `Bearer ${session.token}` },
      form: { type: "build", userid: String(session.userId), baseid: "0" },
    });
    if (!response.ok())
      throw new Error(
        `Building the friend's yard failed: HTTP ${response.status()} ${(await response.text()).slice(0, 300)}`,
      );
  } finally {
    await api.dispose();
  }
};

/**
 * One more account with a built yard, for the friend's-yard check
 * (friendYard.ts, bug report #70, 24 Nov 2026). The check befriends it only
 * for its own step and parts again after, so every other window sees the
 * account as it always was. It reaches the workers through LAYOUT_FRIEND.
 */
const makeFriend = async (index: number): Promise<Account> => {
  const friend = await register(index);
  await buildYard(await signIn(friend));
  return friend;
};

export default async function globalSetup(config: FullConfig): Promise<void> {
  assertSafeSettings();
  const workers = Math.max(1, config.workers);
  const accounts: Account[] = [];
  for (let index = 0; index < workers; index += 1) accounts.push(await register(index));
  process.env["LAYOUT_ACCOUNTS"] = JSON.stringify(accounts);
  process.env["LAYOUT_FRIEND"] = JSON.stringify(await makeFriend(workers));
}
