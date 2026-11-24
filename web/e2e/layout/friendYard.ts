import { expect, test, type Page } from "@playwright/test";
import { BUSY_PAGE_TIMEOUT, closeAll, openFriendsScreen, untilStill, waitForYard } from "./game";
import type { Profile } from "./profiles";
import { settings } from "./settings";

/**
 * The account menu in a friend's yard (bug report #70, 24 Nov 2026): on a
 * phone upright the critter moves to the top-right corner there, and the
 * menu, still hung from the critter's left edge, ran off the right of the
 * screen. The check's account befriends the friend globalSetup made, visits
 * it from the full Friends screen, opens the menu and measures it, then
 * parts and goes home: every other window sees the account friendless, as
 * it always was.
 */

const TOLERANCE = 2;

interface Session {
  readonly token: string;
  readonly userId: number;
}

const apiUrl = (path: string): string => `${settings.serverUrl}/api/${settings.apiVersion}${path}`;

/** The game's own session in the page (it swaps the token on boot; a new sign-in would sign it out). */
const pageSession = async (page: Page): Promise<Session | null> =>
  page.evaluate(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("bymr.session") ?? "{}") as Record<string, unknown>;
      const token = stored["token"];
      const userId = stored["userId"];
      return typeof token === "string" && typeof userId === "number" ? { token, userId } : null;
    } catch {
      return null;
    }
  });

/** The friend globalSetup made, signed in over the API (it plays nowhere, so nothing is signed out). */
const friendSession = async (page: Page): Promise<Session | null> => {
  const friend = JSON.parse(process.env["LAYOUT_FRIEND"] ?? "null") as {
    email: string;
    password: string;
  } | null;
  if (!friend) return null;
  const response = await page.request.post(apiUrl("/player/getinfo"), {
    form: { email: friend.email, password: friend.password, sessionType: "game" },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const token = body["token"];
  const userId = body["userId"];
  return response.ok() && typeof token === "string" && typeof userId === "number"
    ? { token, userId }
    : null;
};

/** A friends route as one player; the reason on failure, else null. */
const friendsCall = async (
  page: Page,
  as: Session,
  path: string,
  data: Record<string, unknown>,
): Promise<string | null> => {
  const response = await page.request.post(apiUrl(path), {
    headers: { Authorization: `Bearer ${as.token}` },
    data,
  });
  return response.ok() ? null : `${path}: HTTP ${response.status()} ${(await response.text()).slice(0, 200)}`;
};

/** Friends for this step: the account asks, the friend asks back (which accepts). */
const befriend = async (page: Page): Promise<{ me: Session; friend: Session } | string> => {
  const me = await pageSession(page);
  if (!me) return "no game session in the page";
  const friend = await friendSession(page);
  if (!friend) return "the friend account (LAYOUT_FRIEND) could not sign in";
  const asked =
    (await friendsCall(page, me, "/bm/friends/request", { userid: friend.userId })) ??
    (await friendsCall(page, friend, "/bm/friends/request", { userid: me.userId }));
  return asked ?? { me, friend };
};

let pair: { me: Session; friend: Session } | null = null;

/** From the own yard into the friend's yard; the reason when there is no way in, else null. */
export const openFriendYard = async (page: Page): Promise<string | null> => {
  await closeAll(page);
  const made = await befriend(page);
  if (typeof made === "string") return `could not make friends: ${made}`;
  pair = made;
  // The Friends screen lists what the game loaded at the start.
  await page.reload();
  await waitForYard(page);
  if (!(await openFriendsScreen(page))) return "no Friends screen on this screen";
  const visit = page
    .locator(".overlay__layer .friends-screen")
    .getByRole("button", { name: "Visit", exact: true })
    .first();
  const listed = await visit
    .waitFor({ state: "visible", timeout: BUSY_PAGE_TIMEOUT })
    .then(() => true)
    .catch(() => false);
  if (!listed) return "the Friends screen lists no friend to visit (globalSetup makes one)";
  await visit.click({ timeout: BUSY_PAGE_TIMEOUT });
  const arrived = await page
    .locator(".hud.hud--no-readouts")
    .first()
    .waitFor({ state: "attached", timeout: 90_000 })
    .then(() => true)
    .catch(() => false);
  if (!arrived) return "the friend's yard never loaded";
  // Put away the help hints a first visit may show.
  await page.waitForTimeout(1500);
  for (let round = 0; round < 2; round += 1) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(300);
  }
  // A yard that fails to load drops the player back home.
  if ((await page.locator(".hud.hud--no-readouts").count()) === 0)
    return "the friend's yard did not stay open (its load failed)";
  return null;
};

interface MenuReport {
  readonly problems: string[];
  readonly notes: string[];
}

/** Measured in the page: the open account menu and each of its items on the screen. */
const measureMenu = (tolerance: number): MenuReport => {
  const problems: string[] = [];
  const notes: string[] = [];
  const width = window.innerWidth;
  const height = window.innerHeight;
  // Measured in the own yard instead, the check would pass for the wrong reason.
  if (!document.querySelector(".hud.hud--no-readouts"))
    return { problems: ["not in a friend's yard when the menu was measured"], notes };
  const list = [...document.querySelectorAll<HTMLElement>(".account-menu__list")].find(
    (element) => !element.hidden && element.getBoundingClientRect().width > 0,
  );
  if (!list) return { problems: ["the account menu did not open"], notes };
  const round = (box: DOMRect): string =>
    `${Math.round(box.left)}..${Math.round(box.right)} x ${Math.round(box.top)}..${Math.round(box.bottom)}`;
  const inside = (box: DOMRect): boolean =>
    box.left >= -tolerance &&
    box.top >= -tolerance &&
    box.right <= width + tolerance &&
    box.bottom <= height + tolerance;
  const box = list.getBoundingClientRect();
  notes.push(`menu ${round(box)} on ${width}x${height}`);
  if (!inside(box)) problems.push(`the account menu sticks out of the screen: ${round(box)}`);
  for (const item of list.querySelectorAll<HTMLElement>('[role="menuitem"]')) {
    if (item.hidden) continue;
    const itemBox = item.getBoundingClientRect();
    if (itemBox.width === 0 || itemBox.height === 0) continue;
    const name = (item.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
    // Across only: on a short screen the menu scrolls, and the items below
    // its fold are in reach (the menu's own box is checked above).
    if (itemBox.left < -tolerance || itemBox.right > width + tolerance)
      problems.push(`"${name}" is not on the screen: ${round(itemBox)}`);
  }
  return { problems, notes };
};

/** Opens the account menu in the friend's yard and checks it is all on the screen. */
export const checkFriendMenu = async (page: Page, profile: Profile): Promise<void> => {
  const button = page.locator(".account-menu__button").filter({ visible: true }).first();
  await button.waitFor({ state: "visible", timeout: BUSY_PAGE_TIMEOUT });
  await untilStill(button);
  await button.click({ timeout: BUSY_PAGE_TIMEOUT });
  await page
    .locator(".account-menu__list:not([hidden])")
    .first()
    .waitFor({ state: "visible", timeout: BUSY_PAGE_TIMEOUT })
    .catch(() => undefined);
  await page.waitForTimeout(500);
  const report = await page.evaluate(measureMenu, TOLERANCE);
  test.info().annotations.push({
    type: "layout",
    description: `Account menu in a friend's yard: ${report.notes.join("; ")}`,
  });
  if (report.problems.length > 0) {
    const body = await page.screenshot({ timeout: 15_000 }).catch(() => null);
    if (body)
      await test.info().attach(`${profile.id}-friend-account-menu.png`, {
        body,
        contentType: "image/png",
      });
  }
  expect
    .soft(
      report.problems,
      `Account menu in a friend's yard on ${profile.label} (${profile.width}x${profile.height})`,
    )
    .toEqual([]);
  await page.keyboard.press("Escape").catch(() => undefined);
};

/** Parts from the friend again, and back to the own yard: a reload opens the player's own yard. */
export const leaveFriendYard = async (page: Page): Promise<void> => {
  if (pair) {
    const me = (await pageSession(page)) ?? pair.me;
    await friendsCall(page, me, "/bm/friends/remove", { userid: pair.friend.userId });
    pair = null;
  }
  await page.reload();
  await waitForYard(page);
};
