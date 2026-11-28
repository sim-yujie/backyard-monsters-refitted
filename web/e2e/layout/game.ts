import {
  request,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
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
  // Seeded once per tab: the game swaps the token for a fresh one on boot and
  // the server drops the old one, so a reload must keep the game's own copy.
  await context.addInitScript((stored) => {
    try {
      if (window.sessionStorage.getItem("layout-check-seeded")) return;
      window.localStorage.setItem("bymr.session", stored);
      window.sessionStorage.setItem("layout-check-seeded", "1");
    } catch {
      // No storage: the game shows its login screen and boot reports it.
    }
  }, JSON.stringify(session));
  await damageOwnYard(context);
  const page = await context.newPage();
  await page.goto("/");
  await waitForYard(page);
  return { context, page };
};

/** How many buildings come back damaged: enough for the post-attack banner. */
const DAMAGED_BUILDINGS = 3;

/**
 * The yard comes back attacked (beta 9 play-test, 23 Nov 2026): a few
 * buildings below full health in the yard's answers, so the post-attack
 * banner ("Your yard was attacked: 3 buildings damaged · Repair all") stands
 * at the top for every window the check opens, as it does for a player who
 * was raided. It sat on Build's tab row and caught its taps; a window it
 * covers fails as covered. Only the browser's copy is changed: no walls, no
 * Town Hall, nothing saved. `/bm/yard/state` answers carry the health too
 * and would put it back, so they get the same damage.
 */
const damageOwnYard = async (context: BrowserContext): Promise<void> => {
  const damaged = new Set<string>();
  await context.route(/\/(base\/load|bm\/yard\/state)(\?|$)/, async (route) => {
    const response = await route.fetch();
    const text = await response.text();
    let body = text;
    try {
      const save = JSON.parse(text) as {
        buildingdata?: Record<string, { t?: unknown; rE?: unknown } | null>;
        buildinghealthdata?: unknown;
      };
      if (damaged.size === 0 && save.buildingdata && typeof save.buildingdata === "object") {
        for (const [key, building] of Object.entries(save.buildingdata)) {
          if (damaged.size >= DAMAGED_BUILDINGS) break;
          if (!building || typeof building.t !== "number" || building.t === 14 || building.t === 17) continue;
          if (building.rE) continue;
          damaged.add(key);
        }
      }
      if (damaged.size > 0 && "buildinghealthdata" in save) {
        // An empty one may come as [] (the save's PHP shape), which would drop string keys.
        const health: Record<string, number> =
          save.buildinghealthdata && !Array.isArray(save.buildinghealthdata) && typeof save.buildinghealthdata === "object"
            ? { ...(save.buildinghealthdata as Record<string, number>) }
            : {};
        for (const key of damaged) health[key] = 1;
        save.buildinghealthdata = health;
        body = JSON.stringify(save);
      }
    } catch {
      // Not JSON: passed on as it came.
    }
    await route.fulfill({ response, body });
  });
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
  await untilResponsive(page);
};

/**
 * Without a graphics card the first frames of the yard can hold the page for
 * many seconds: the first click after boot timed out on five screens while
 * the page was busy (layout check, 15 Nov). Waits until Build would take a
 * press and the page answers quickly twice in a row.
 */
const untilResponsive = async (page: Page): Promise<void> => {
  await page
    .locator('.yard-dock__button[data-dock="build"]:not([disabled])')
    .first()
    .click({ trial: true, timeout: settings.bootTimeout });
  const end = Date.now() + 15_000;
  let quick = 0;
  while (quick < 2 && Date.now() < end) {
    const start = Date.now();
    await page.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 0))),
    );
    quick = Date.now() - start < 250 ? quick + 1 : 0;
  }
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
  ".friends-window",
  ".friends-screen",
  ".ach-screen",
  ".alliance-window",
  ".building-panel",
  ".auto-attack--result",
  ".xfer-tray",
  ".attack-window",
  // A wave event's arrival pop-up (beta 10): it opens by itself on a yard
  // while a wave event is on, so it is closed with the rest.
  ".wave-intro",
];

/**
 * Shows a wave event's arrival pop-up again (beta 10): forgets that this
 * device saw it and reloads; it opens on its own while a wave event is on.
 * False when no wave event is on (the sandbox yard outside one).
 *
 * Not `waitForYard`: its quiet-start check presses Escape on any pop-up at
 * boot, which closed this one and marked it seen, so the case was always
 * skipped, even with a wave event on (wmi-events, 27 Nov 2026).
 */
export const openWaveIntro = async (page: Page): Promise<boolean> => {
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("bymr.waveIntroSeen");
    } catch {
      /* no storage: no pop-up either */
    }
  });
  await page.reload();
  await page
    .locator('.yard-dock__button[data-dock="build"]:not([disabled])')
    .first()
    .waitFor({ state: "visible", timeout: settings.bootTimeout });
  return page
    .locator(".overlay__layer .wave-intro")
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
};

const openWindows = (page: Page) =>
  page.locator(`.overlay__layer :is(${WINDOW_CLASSES.join(", ")})`);

/**
 * Closes every window the check opens, then the account menu and the dock's
 * fan; if one will not close, reloads the page and waits for the yard again.
 */
export const closeAll = async (page: Page): Promise<void> => {
  // Repeat attack's sheet from the build's preview: closed the way it opened
  // (its working bar has no button while it runs).
  await page
    .evaluate(() => {
      const shut = (globalThis as Record<string, unknown>)["__repeatSheetClose"];
      (globalThis as Record<string, unknown>)["__repeatSheetClose"] = null;
      if (typeof shut === "function") (shut as () => void)();
      // The move tray's preview (beta 9 #7) likewise.
      const tray = (globalThis as Record<string, unknown>)["__transferPreviewClose"];
      (globalThis as Record<string, unknown>)["__transferPreviewClose"] = null;
      if (typeof tray === "function") (tray as () => void)();
    })
    .catch(() => undefined);
  // The Repeat attack's result covers the dock's More bubble on a phone
  // upright, and the test's mouse rests there from the step that pressed
  // More. When the result closes, More is under the mouse again and opens
  // its fan by hover (BubbleMenu), which then covers World chat for the
  // next step. A real touch has no hover, so the mouse moves to the yard's
  // middle (on the result's scrim) first, and the result closes by key.
  const result = page
    .locator('.overlay__layer .auto-attack--result button[aria-label^="Close"]')
    .filter({ visible: true })
    .first();
  if ((await result.count()) > 0) {
    const size = page.viewportSize();
    if (size) await page.mouse.move(Math.round(size.width / 2), Math.round(size.height * 0.3));
    await result.press("Enter", { timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
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
 * How long a dock press, or a control it brings up, may wait for the page.
 * Longer than a click needs: a busy page (the yard drawn without a graphics
 * card, worst just after it boots) can take seconds to answer at all.
 */
export const BUSY_PAGE_TIMEOUT = 20_000;

/**
 * Presses a round dock button by its `data-dock` name. On a phone or with the
 * bubble menu the button may be folded into Menu or More first.
 *
 * "No way in" (false) is decided from the page, never from a timer: no such
 * button, or the button switched off for this yard (its own `hidden`, as
 * Defences, Events and Alliance do), or still not shown after its holder
 * opened. A short wait on a page busy drawing the yard read as "no way in"
 * though Build was on screen (odd-980 on CI, 16 Nov 2026).
 */
export const pressDock = async (page: Page, name: string): Promise<boolean> => {
  const button = page.locator(`.yard-dock__button[data-dock="${name}"]`).first();
  if ((await button.count()) === 0) return false;
  if ((await button.getAttribute("hidden")) !== null) return false;
  if (!(await button.isVisible())) {
    // Folded into More (bubble menu) or Menu (phone): a shut fan or sheet hides it.
    for (const holder of ["more", "menu"]) {
      const opener = page.locator(`.yard-dock__button[data-dock="${holder}"]`);
      if (await opener.isVisible()) {
        await opener.click({ timeout: BUSY_PAGE_TIMEOUT });
        break;
      }
    }
    const shown = await button
      .waitFor({ state: "visible", timeout: BUSY_PAGE_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (!shown) return false;
  }
  await untilStill(button);
  await button.click({ timeout: BUSY_PAGE_TIMEOUT });
  return true;
};

/**
 * Waits for a control's own finite animations to end before it is pressed.
 * More's bubbles fly out one after another (bubble-menu.css: each waits
 * 40 ms per place, then springs 300 ms). Playwright counts a bubble as steady
 * while it still waits folded on More; it then moved under the press, which
 * landed on nothing, and Alerts never opened (ipad-split on CI, run
 * 43879130176, 16 Nov 2026: the fan open, the window "not on the screen").
 */
export const untilStill = async (control: Locator): Promise<void> => {
  await control
    .evaluate(async (element) => {
      const running = element
        .getAnimations({ subtree: true })
        .filter((animation) =>
          Number.isFinite(Number(animation.effect?.getComputedTiming().endTime ?? Infinity)),
        );
      await Promise.race([
        Promise.all(running.map((animation) => animation.finished.catch(() => undefined))),
        new Promise((done) => setTimeout(done, 2000)),
      ]);
    })
    .catch(() => undefined);
};

/** Opens the full Friends screen: the Friends button's popup, then its "All friends". */
export const openFriendsScreen = async (page: Page): Promise<boolean> => {
  if (!(await pressDock(page, "friends"))) return false;
  const all = page.locator(".overlay__layer .friends-window__all").first();
  const shown = await all
    .waitFor({ state: "visible", timeout: BUSY_PAGE_TIMEOUT })
    .then(() => true)
    .catch(() => false);
  if (!shown) return false;
  await all.click({ timeout: BUSY_PAGE_TIMEOUT });
  return true;
};

/** The own yard is still up (Build pressable); reloads once if not. */
export const yardIsUp = async (page: Page): Promise<boolean> => {
  const build = page.locator('.yard-dock__button[data-dock="build"]:not([disabled])');
  if (await build.isVisible()) return true;
  await page.reload();
  await waitForYard(page);
  return build.isVisible();
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
  const shown = await item
    .waitFor({ state: "visible", timeout: BUSY_PAGE_TIMEOUT })
    .then(() => true)
    .catch(() => false);
  if (!shown) {
    await page.keyboard.press("Escape");
    return false;
  }
  await item.click({ timeout: BUSY_PAGE_TIMEOUT });
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

/** Lines showing in World chat now. */
export const chatLines = (page: Page): Promise<number> => page.locator(".chat-line").count();

/** Shuts World chat again so later checks see the plain yard. */
export const closeWorldChat = async (page: Page): Promise<void> => {
  const tab = page.locator(".chat-box__tab").first();
  if (
    (await tab.isVisible().catch(() => false)) &&
    (await tab.getAttribute("aria-expanded")) === "true"
  ) {
    await tab.click().catch(() => undefined);
  }
};

/**
 * The Repeat attack's result after a conquered camp, from the build's
 * preview (`__autoAttackResult`, VITE_LAYOUT_CHECK): the sandbox yard is not
 * on Map Room 2, so no real Repeat attack can reach it.
 */
export const openRepeatResult = async (page: Page): Promise<boolean> => {
  const opened = await page.evaluate(() => {
    const open = (globalThis as Record<string, unknown>)["__autoAttackResult"];
    if (typeof open !== "function") return false;
    return Boolean((open as (kind: string) => unknown)("won"));
  });
  if (!opened) return false;
  await page.locator(".overlay__layer .auto-attack--result").first().waitFor({ timeout: 10_000 });
  // The take-over price arrives a moment later (answered in the page).
  await page.locator(".overlay__layer .auto-attack--result .end-takeover__take:not([disabled])").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  return true;
};

/**
 * Repeat attack's sheet in one of its states (look A), from the build's
 * preview (`__autoAttackConfirm`, VITE_LAYOUT_CHECK), filled with a fixed busy
 * army: the sandbox yard is not on Map Room 2. `closeAll` closes it.
 */
export const openRepeatSheet = async (page: Page, state: string): Promise<boolean> => {
  const opened = await page.evaluate((which) => {
    const open = (globalThis as Record<string, unknown>)["__autoAttackConfirm"];
    if (typeof open !== "function") return false;
    const shut = (open as (state: string) => unknown)(which);
    (globalThis as Record<string, unknown>)["__repeatSheetClose"] = shut;
    return typeof shut === "function";
  }, state);
  if (!opened) return false;
  await page.locator(".overlay__layer .auto-attack--confirm, .overlay__layer .auto-attack--bar").first().waitFor({ timeout: 10_000 });
  // The portraits and icons size the tiles: wait for them.
  await page
    .waitForFunction(() => [...document.querySelectorAll(".overlay__layer .auto-attack img")].every((image) => (image as HTMLImageElement).complete), null, {
      timeout: 10_000,
    })
    .catch(() => undefined);
  return true;
};

/**
 * Opens smart moving (beta 9) on `state` from the build's preview: the "Bring
 * saved army?" sheet, or the Attack window with its "can't gather" note.
 * Closed by `closeAll` the way it opened, as Repeat attack's sheet is.
 */
export const openSmartMove = async (page: Page, state: string): Promise<boolean> => {
  const opened = await page.evaluate((which) => {
    const open = (globalThis as Record<string, unknown>)["__smartMove"];
    if (typeof open !== "function") return false;
    const shut = (open as (state: string) => unknown)(which);
    (globalThis as Record<string, unknown>)["__repeatSheetClose"] = shut;
    return typeof shut === "function";
  }, state);
  if (!opened) return false;
  await page.locator(".overlay__layer .attack-window").first().waitFor({ timeout: 10_000 });
  await page
    .waitForFunction(() => [...document.querySelectorAll(".overlay__layer .attack-window img")].every((image) => (image as HTMLImageElement).complete), null, {
      timeout: 10_000,
    })
    .catch(() => undefined);
  return true;
};

/**
 * Opens the Baiter window's friend tabs (beta 9 #4) on `view`, or a friend's
 * test army with `view` "host", from the build's preview with a busy list.
 */
export const openBaiterPreview = async (page: Page, view: string): Promise<boolean> => {
  const opened = await page.evaluate((which) => {
    const hooks = globalThis as Record<string, unknown>;
    const open = which === "host" ? hooks["__baiterFriendTest"] : hooks["__baiterWindow"];
    if (typeof open !== "function") return false;
    const shut = which === "host" ? (open as () => unknown)() : (open as (view: string) => unknown)(which);
    return typeof shut === "function";
  }, view);
  if (!opened) return false;
  await page.locator(".overlay__layer .baiter-window").first().waitFor({ timeout: 10_000 });
  // The list fills from the preview's answer.
  if (view !== "host") await page.locator(".overlay__layer .baiter-window .friends-row").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  return true;
};

/**
 * The world map's move tray (beta 9 #7), Bring to or Move from, from the
 * build's preview (`__transferPreview`, VITE_LAYOUT_CHECK): the sandbox yard
 * has no outposts. `closeAll` closes it with its close button.
 */
/**
 * The wild monster alert (beta 10) at its busiest, from the build's preview
 * (`__raidAlert`, VITE_LAYOUT_CHECK): Threat 14, 4 sides, a level 3 Fomor.
 * It has no close button (the player must answer); `closeAll` closes it the
 * way it opened.
 */
export const openRaidAlert = async (page: Page): Promise<boolean> => {
  const opened = await page.evaluate(() => {
    const open = (globalThis as Record<string, unknown>)["__raidAlert"];
    if (typeof open !== "function") return false;
    const shut = (open as (champion: number, level: number) => unknown)(3, 3);
    (globalThis as Record<string, unknown>)["__repeatSheetClose"] = shut;
    return typeof shut === "function";
  });
  if (!opened) return false;
  await page.locator(".overlay__layer .raid-alert").first().waitFor({ timeout: 10_000 });
  await page
    .waitForFunction(() => [...document.querySelectorAll(".overlay__layer .raid-alert img")].every((image) => (image as HTMLImageElement).complete), null, {
      timeout: 10_000,
    })
    .catch(() => undefined);
  return true;
};

export const openMoveTray = async (page: Page, state: "in" | "out"): Promise<boolean> => {
  const opened = await page.evaluate(async (which) => {
    const open = (globalThis as Record<string, unknown>)["__transferPreview"];
    if (typeof open !== "function") return false;
    const shut = await (open as (state: string) => Promise<() => void> | null)(which);
    (globalThis as Record<string, unknown>)["__transferPreviewClose"] = shut;
    return typeof shut === "function";
  }, state);
  if (!opened) return false;
  await page.locator(".overlay__layer .xfer-tray").first().waitFor({ timeout: 10_000 });
  await page
    .waitForFunction(() => [...document.querySelectorAll(".overlay__layer .xfer-tray img")].every((image) => (image as HTMLImageElement).complete), null, {
      timeout: 10_000,
    })
    .catch(() => undefined);
  return true;
};
