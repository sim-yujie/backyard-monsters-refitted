import { expect, test, type Page } from "@playwright/test";
import { BUSY_PAGE_TIMEOUT, closeAll } from "./game";
import type { Profile } from "./profiles";

/**
 * More's fan (the bubble menu, web/src/ui/yard/BubbleMenu.ts) at its busiest:
 * every button it can hold shown (a sandbox yard hides Defences, Alliance and
 * Reports, so the check shows them), opened, and each bubble, its disc and its
 * sign, wholly on the screen below the top bar and pressable at its middle.
 * On a 390x664 phone the column ran up under the top bar and Mail, Alliance
 * and Reports could not be pressed; on a phone on its side the top row sat
 * half under it (old-layout fix, beta 9).
 */

const TOLERANCE = 2;
/** How long the bubbles take to fly out (bubble-menu.css: 300 ms, 40 ms apart). */
const FLY_MS = 900;

interface FanReport {
  readonly problems: string[];
  readonly notes: string[];
}

/** Shows every button the fan holds; returns the ones it showed, to hide again. */
const showAll = (): string[] => {
  const shown: string[] = [];
  for (const item of document.querySelectorAll<HTMLElement>(".bubble-menu__fan > .yard-dock__button")) {
    if (!item.hidden) continue;
    item.hidden = false;
    shown.push(item.dataset["dock"] ?? "");
  }
  return shown;
};

const hideAgain = (names: string[]): void => {
  for (const name of names) {
    const item = document.querySelector<HTMLElement>(
      `.bubble-menu__fan > .yard-dock__button[data-dock="${CSS.escape(name)}"]`,
    );
    if (item) item.hidden = true;
  }
};

/** Measured in the page: every bubble on the screen, under the top bar, not covered. */
const measureFan = (tolerance: number): FanReport => {
  const problems: string[] = [];
  const notes: string[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const hud = document.querySelector(".hud");
  const hudBottom = hud ? Math.max(0, hud.getBoundingClientRect().bottom) : 0;
  const items = [...document.querySelectorAll<HTMLElement>(".bubble-menu__fan > .yard-dock__button")].filter(
    (item) => !item.hidden,
  );
  notes.push(`${items.length} bubbles, top bar ends at ${Math.round(hudBottom)}`);
  if (items.length === 0) problems.push("the fan shows no bubbles");
  for (const item of items) {
    const name = item.dataset["dock"] ?? "?";
    const disc = item.querySelector(".yard-dock__disc") ?? item;
    const label = item.querySelector(".yard-dock__label");
    for (const [part, element] of [["disc", disc], ["sign", label]] as const) {
      if (!element) continue;
      const box = element.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      if (box.top < hudBottom - tolerance)
        problems.push(`${name}'s ${part} runs under the top bar (top ${Math.round(box.top)}, bar ends ${Math.round(hudBottom)})`);
      else if (box.left < -tolerance || box.right > vw + tolerance || box.bottom > vh + tolerance)
        problems.push(
          `${name}'s ${part} sticks out of the ${vw}x${vh} screen (${Math.round(box.left)},${Math.round(box.top)} to ${Math.round(box.right)},${Math.round(box.bottom)})`,
        );
    }
    const box = disc.getBoundingClientRect();
    const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    if (!hit || !item.contains(hit)) {
      const what = hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(" ")[0]}` : "nothing";
      problems.push(`${name} is covered by ${what} at its middle`);
    }
  }
  return { problems, notes };
};

/** Opens More with every bubble showing and checks them; the reason when there is no fan, else null. */
export const checkFan = async (page: Page, profile: Profile): Promise<string | null> => {
  await closeAll(page);
  const more = page.locator('.yard-dock__button[data-dock="more"]').first();
  if ((await more.count()) === 0 || !(await more.isVisible())) return "no More button on this screen";
  const shown = await page.evaluate(showAll);
  try {
    await more.click({ timeout: BUSY_PAGE_TIMEOUT });
    await page.waitForTimeout(FLY_MS);
    const report = await page.evaluate(measureFan, TOLERANCE);
    test.info().annotations.push({ type: "layout", description: `More's fan: ${report.notes.join("; ")}` });
    if (report.problems.length > 0) {
      const body = await page.screenshot({ timeout: 15_000 }).catch(() => null);
      if (body) await test.info().attach(`${profile.id}-more-fan.png`, { body, contentType: "image/png" });
    }
    expect.soft(report.problems, `More's fan on ${profile.label} (${profile.width}x${profile.height})`).toEqual([]);
  } finally {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.evaluate(hideAgain, shown).catch(() => undefined);
    await page.waitForTimeout(400);
  }
  return null;
};
