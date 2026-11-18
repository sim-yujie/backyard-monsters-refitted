import { expect, test, type Page } from "@playwright/test";
import { BUSY_PAGE_TIMEOUT, closeAll, pressDock } from "./game";
import type { Profile } from "./profiles";

/**
 * The attack dock (owner, 18 Nov 2026, proposal A): the layout check starts
 * a real attack on a Map Room 1 wild monster tribe from the sandbox yard and
 * checks the dock's pinned tab row (Army, Catapult and a siege weapon when
 * the yard has one) with the sheet closed (a phone upright) and on every
 * tab: the row on the screen, never covered, tabs at least 44 px, and the
 * shown tab's window with a list the player can see. Run last on each
 * screen: it leaves the yard for the attack.
 */

/** The fewest pixels of the shown window's list in sight (a few rows, layout rules). */
const MIN_BODY = 120;
const TAP = 44;
const TOLERANCE = 2;

/** From the yard into an attack on a wild monster tribe; false with the reason when there is no way in. */
export const openAttack = async (page: Page): Promise<string | null> => {
  await closeAll(page);
  if (!(await pressDock(page, "map"))) return "no Map button";
  const map = page.locator(".mr1");
  await map.waitFor({ timeout: 60_000 }).catch(() => undefined);
  if ((await map.count()) === 0) return "no Map Room 1 map";
  // The list (a phone's first view) or the map's pins: an unwrecked tribe that is not the practice camp.
  const tile = page.locator(".mr1-tile:not(.mr1-tile--wrecked):not(.mr1-tile--practice)").filter({ visible: true });
  const pin = page
    .locator(".mr1-pin--tribe:not(.mr1-pin--practice) .mr1-pin__button")
    .filter({ visible: true });
  await Promise.race([
    tile.first().waitFor({ timeout: 30_000 }),
    pin.first().waitFor({ timeout: 30_000 }),
  ]).catch(() => undefined);
  if ((await tile.count()) > 0) await tile.first().click({ timeout: BUSY_PAGE_TIMEOUT });
  else if ((await pin.count()) > 0) await pin.first().click({ timeout: BUSY_PAGE_TIMEOUT });
  else return "no wild monster tribe on the map";
  const attack = page.locator("button.mr1-card__button.btn--primary:not([disabled])").filter({ visible: true });
  const ready = await attack
    .first()
    .waitFor({ timeout: BUSY_PAGE_TIMEOUT })
    .then(() => true)
    .catch(() => false);
  if (!ready) return "the tribe's Attack button is off";
  await attack.first().click({ timeout: BUSY_PAGE_TIMEOUT });
  const tabs = page.locator(".attack-dock__tabs:not([hidden])");
  const up = await tabs
    .waitFor({ timeout: 90_000 })
    .then(() => true)
    .catch(() => false);
  if (!up) return "the attack's tab row never showed";
  // Let the sheet or column settle (the strip measures, the camera fits).
  await page.waitForTimeout(1500);
  return null;
};

interface DockReport {
  readonly problems: string[];
  readonly notes: string[];
}

/** Measured in the page: the rules for one state of the dock. */
const measureDock = (args: { open: boolean; minBody: number; tap: number; tolerance: number }): DockReport => {
  const problems: string[] = [];
  const notes: string[] = [];
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dock = document.querySelector<HTMLElement>(".attack-dock");
  const row = document.querySelector<HTMLElement>(".attack-dock__tabs");
  if (!dock || !row) return { problems: ["no attack dock or tab row"], notes };
  const inside = (box: DOMRect): boolean =>
    box.left >= -args.tolerance &&
    box.top >= -args.tolerance &&
    box.right <= width + args.tolerance &&
    box.bottom <= height + args.tolerance;
  const dockBox = dock.getBoundingClientRect();
  if (!inside(dockBox))
    problems.push(`the dock sticks out of the screen: ${Math.round(dockBox.left)},${Math.round(dockBox.top)} ${Math.round(dockBox.width)}x${Math.round(dockBox.height)}`);
  for (const tab of row.querySelectorAll<HTMLElement>(".attack-dock__tab")) {
    const name = (tab.textContent ?? "").trim();
    const box = tab.getBoundingClientRect();
    if (!inside(box) || box.width === 0) {
      problems.push(`tab "${name}" is not on the screen`);
      continue;
    }
    if (box.width < args.tap - 0.5 || box.height < args.tap - 0.5)
      problems.push(`tab "${name}" is ${Math.round(box.width)}x${Math.round(box.height)}, under ${args.tap} px`);
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (!hit || !(hit === tab || tab.contains(hit))) problems.push(`tab "${name}" is covered`);
  }
  if (!args.open) return { problems, notes };
  const selected = row.querySelector<HTMLElement>('.attack-dock__tab[aria-selected="true"]');
  const tab = selected?.dataset["tab"];
  if (!tab) {
    problems.push("no tab reads as shown");
    return { problems, notes };
  }
  const body = dock.querySelector<HTMLElement>(".attack-dock__body");
  const panel = body?.querySelector<HTMLElement>(`:scope > [data-dock-tab="${tab}"]`);
  if (!body || !panel) {
    problems.push(`the ${tab} tab shows no window`);
    return { problems, notes };
  }
  const bodyBox = body.getBoundingClientRect();
  const panelBox = panel.getBoundingClientRect();
  const seen = Math.min(bodyBox.bottom, height) - Math.max(bodyBox.top, panelBox.top, 0);
  notes.push(`${tab}: body ${Math.round(bodyBox.height)} px, window ${Math.round(panelBox.height)} px`);
  if (panelBox.height === 0) problems.push(`the ${tab} window is empty`);
  else if (seen < Math.min(args.minBody, panelBox.height) - args.tolerance)
    problems.push(`only ${Math.round(seen)} px of the ${tab} window is in sight`);
  if (panelBox.top < bodyBox.top - args.tolerance)
    problems.push(`the ${tab} window opened scrolled: its top is out of sight`);
  // The window under a tab shows no title plate of its own.
  const title = panel.querySelector<HTMLElement>(".panel__title");
  if (title && title.getBoundingClientRect().height > 0) problems.push(`the ${tab} window still shows its title`);
  const rowBox = row.getBoundingClientRect();
  if (rowBox.bottom > bodyBox.top + args.tolerance) problems.push("the tab row overlaps the window under it");
  return { problems, notes };
};

const checkState = async (page: Page, profile: Profile, where: string, open: boolean): Promise<void> => {
  await page.waitForTimeout(500);
  const report = await page.evaluate(measureDock, { open, minBody: MIN_BODY, tap: TAP, tolerance: TOLERANCE });
  test.info().annotations.push({
    type: "layout",
    description: `Attack dock ${where}${report.notes.length ? `: ${report.notes.join("; ")}` : ""}`,
  });
  if (report.problems.length > 0) {
    const body = await page.screenshot({ timeout: 15_000 }).catch(() => null);
    if (body)
      await test.info().attach(`${profile.id}-attack-dock-${where.replace(/[^a-z0-9]+/gi, "-")}.png`, {
        body,
        contentType: "image/png",
      });
  }
  expect.soft(report.problems, `Attack dock ${where} on ${profile.label} (${profile.width}x${profile.height})`).toEqual([]);
};

/** The dock's states: closed (a phone's sheet), then each tab shown. */
export const checkAttackDock = async (page: Page, profile: Profile): Promise<void> => {
  const sheet = (await page.locator(".attack-dock--sheet").count()) > 0;
  if (sheet) await checkState(page, profile, "sheet closed", false);
  const tabs = page.locator(".attack-dock__tab");
  const count = await tabs.count();
  for (let index = 0; index < count; index += 1) {
    const tab = tabs.nth(index);
    const name = (await tab.innerText()).trim();
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click({ timeout: BUSY_PAGE_TIMEOUT });
    await checkState(page, profile, `tab "${name}"`, true);
  }
};
