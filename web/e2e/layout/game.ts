import { request, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { settings } from "./settings";
import type { Profile } from "./profiles";

/**
 * Driving the game for the layout check: sign in, wait for the yard, open and
 * close windows, fill World chat. Everything goes through the real client and
 * the real server (started by playwright.config.ts).
 */

/** The account globalSetup made, one per worker so logins never sign each other out. */
export const account = (workerIndex: number): { email: string; password: string } => {
  const list = JSON.parse(process.env["LAYOUT_ACCOUNTS"] ?? "[]") as {
    email: string;
    password: string;
  }[];
  const picked = list[workerIndex % Math.max(1, list.length)];
  if (!picked)
    throw new Error(
      "No layout-check account: globalSetup did not run (LAYOUT_ACCOUNTS is empty).",
    );
  return picked;
};

/**
 * Signs in over the API and returns the session the client keeps in
 * localStorage (`bymr.session`, web/src/api/auth.ts). Each sign-in makes a new
 * token and drops the old one, so every context gets its own.
 */
const signIn = async (email: string, password: string): Promise<Record<string, unknown>> => {
  const api = await request.newContext({ baseURL: settings.serverUrl });
  try {
    const response = await api.post(`/api/${settings.apiVersion}/player/getinfo`, {
      form: { email, password, sessionType: "game" },
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (
      !response.ok() ||
      typeof body["token"] !== "string" ||
      typeof body["userId"] !== "number"
    ) {
      throw new Error(
        `Sign-in for ${email} failed: HTTP ${response.status()} ${JSON.stringify(body).slice(0, 300)}`,
      );
    }
    return {
      token: body["token"],
      userId: body["userId"],
      username: body["username"] ?? null,
      picSquare: body["pic_square"] ?? null,
      sessionType: "game",
    };
  } finally {
    await api.dispose();
  }
};

export interface Game {
  readonly context: BrowserContext;
  readonly page: Page;
}

/** A new context with the profile's device, signed in, on the yard. */
export const openGame = async (
  browser: Browser,
  profile: Profile,
  workerIndex: number,
): Promise<Game> => {
  const { email, password } = account(workerIndex);
  const session = await signIn(email, password);
  const context = await browser.newContext({ ...profile.context, baseURL: settings.webUrl });
  await context.addInitScript((stored) => {
    try {
      window.localStorage.setItem("bymr.session", stored);
    } catch {
      // No storage: the game shows its login screen and boot reports it.
    }
  }, JSON.stringify(session));
  const page = await context.newPage();
  await page.goto("/");
  await waitForYard(page);
  return { context, page };
};

/** Waits for the own yard: Build enabled. Throws plainly for the ways a boot can fail. */
export const waitForYard = async (page: Page): Promise<void> => {
  const yard = page.locator('.yard-dock__button[data-dock="build"]:not([disabled])');
  const graphicsOff = page.locator(".graphics-off");
  const login = page.locator('input[type="password"]');
  await yard
    .or(graphicsOff)
    .or(login)
    .first()
    .waitFor({ state: "visible", timeout: settings.bootTimeout });
  if (await graphicsOff.isVisible()) {
    throw new Error(
      "The browser has no WebGL here (the game's 'graphics off' notice): not a layout fault.",
    );
  }
  if (await login.isVisible()) {
    throw new Error("The game showed its login screen: the stored session was refused.");
  }
  await expectQuietStart(page);
};

/** Nothing may sit over the yard at the start: the guided start or a pop-up would block every click. */
const expectQuietStart = async (page: Page): Promise<void> => {
  // Give login pop-ups a moment to appear, then put away any the server sent anyway.
  await page.waitForTimeout(1500);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const blocking = await page.evaluate(() =>
      [...document.querySelectorAll(".overlay__layer--modal > *, .overlay__layer--guide > *")]
        .filter(
          (element) =>
            element instanceof HTMLElement &&
            !element.hidden &&
            element.getBoundingClientRect().height > 0,
        )
        .map((element) =>
          typeof element.className === "string" ? element.className : element.tagName,
        ),
    );
    if (blocking.length === 0) return;
    if (attempt === 2) {
      throw new Error(
        `Something covers the yard at the start (${blocking.join(", ")}). The account must be a finished ` +
          "sandbox yard and the server must run with QUIET_LOGIN=1.",
      );
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
};

/** The windows the check opens, by their own class. */
const WINDOW_CLASSES = [
  ".build-menu",
  ".goals-panel",
  ".events-panel",
  ".quests-panel",
  ".notif-screen",
  ".defences-screen",
  ".shop-screen",
  ".mail-screen",
  ".monsters-screen",
  ".friends-screen",
  ".ach-screen",
  ".alliance-window",
  ".building-panel",
];

const openWindows = (page: Page) =>
  page.locator(`.overlay__layer :is(${WINDOW_CLASSES.join(", ")})`);

/**
 * Closes every window the check opens, then the account menu and the dock's
 * fan; if one will not close, reloads the page and waits for the yard again.
 */
export const closeAll = async (page: Page): Promise<void> => {
  for (let round = 0; round < 4; round += 1) {
    const close = openWindows(page)
      .locator('button[aria-label^="Close"]')
      .filter({ visible: true })
      .first();
    if ((await close.count()) === 0) break;
    await close.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
  await page.keyboard.press("Escape").catch(() => undefined);
  if ((await openWindows(page).filter({ visible: true }).count()) > 0) {
    await page.reload();
    await waitForYard(page);
  }
};

/**
 * Presses a round dock button by its `data-dock` name. On a phone or with the
 * bubble menu the button may be folded into Menu or More first.
 */
export const pressDock = async (page: Page, name: string): Promise<boolean> => {
  const button = page.locator(`.yard-dock__button[data-dock="${name}"]`);
  if ((await button.count()) === 0) return false;
  if (!(await button.first().isVisible())) {
    for (const holder of ["more", "menu"]) {
      const opener = page.locator(`.yard-dock__button[data-dock="${holder}"]`);
      if (await opener.isVisible()) {
        await opener.click();
        break;
      }
    }
  }
  await button.first().click({ timeout: 5000 });
  return true;
};

/** Opens the Shop from the Shiny readout in the top bar. */
export const openShop = async (page: Page): Promise<boolean> => {
  const shiny = page.locator('.hud__resource-button[data-resource="shiny"]');
  if (!(await shiny.isVisible())) return false;
  await shiny.click();
  return true;
};

/** Opens Achievements from the account menu. */
export const openAchievements = async (page: Page): Promise<boolean> => {
  const menu = page.locator(".account-menu__button").first();
  if (!(await menu.isVisible())) return false;
  await menu.click();
  const item = page.getByRole("menuitem", { name: /Achievements/i });
  if (!(await item.isVisible().catch(() => false))) {
    await page.keyboard.press("Escape");
    return false;
  }
  await item.click();
  return true;
};

/**
 * Taps the middle of the yard, where the Town Hall usually stands, hoping to
 * open a building's side panel. Best effort: the yard is a canvas, so the test
 * skips when nothing opens.
 */
export const tapYardMiddle = async (page: Page, profile: Profile): Promise<boolean> => {
  const x = Math.round(profile.width / 2);
  const y = Math.round(profile.height / 2);
  if (profile.touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  try {
    await page
      .locator(".overlay__layer .building-panel")
      .first()
      .waitFor({ state: "visible", timeout: 4000 });
    return true;
  } catch {
    return false;
  }
};

/**
 * Opens World chat and fills it with a few lines, as a busy chat on a short
 * screen may push windows about. Returns what it managed, for the report.
 */
export const fillWorldChat = async (page: Page, lines = 6): Promise<string> => {
  const tab = page.locator(".chat-box__tab").first();
  if (!(await tab.isVisible().catch(() => false))) return "no World chat tab on this screen";
  if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
  const input = page.locator(".chat-box__input").first();
  if (!(await input.isVisible().catch(() => false)))
    return "World chat opened but has no input";
  const before = await page.locator(".chat-line").count();
  for (let index = before; index < lines; index += 1) {
    await input.fill(
      `Layout check line ${index + 1}: a longer message so it wraps onto two rows on a phone.`,
    );
    await input.press("Enter");
    // The chat server takes one line per half second (server/src/chat/chatRooms.ts).
    await page.waitForTimeout(650);
  }
  await page
    .waitForFunction((want) => document.querySelectorAll(".chat-line").length >= want, lines, {
      timeout: 8000,
    })
    .catch(() => undefined);
  return `World chat open with ${await page.locator(".chat-line").count()} lines`;
};
