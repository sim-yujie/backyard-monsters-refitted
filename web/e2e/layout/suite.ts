import { expect, test, type Page } from "@playwright/test";
import {
  chatLines,
  closeAll,
  closeWorldChat,
  fillWorldChat,
  openGame,
  tapYardMiddle,
  yardIsUp,
  type Game,
} from "./game";
import { knownFailure } from "./knownFailures";
import { checkWindow, pageFacts, type CheckArgs, type CheckReport } from "./measure";
import { selectedProfiles, type Profile } from "./profiles";
import { settings } from "./settings";
import { CHAT_WINDOWS, MAX_TABS, WINDOWS, type WindowCase } from "./windows";

/**
 * The layout check's tests: for each screen in a spec file's group, one test
 * that boots the game once and checks every window in turn (see
 * defineLayoutSuite below). The measuring itself is in measure.ts.
 */

const TOLERANCE = 2;

/** Lets a window finish opening: its finite animations end (glows that loop forever are ignored). */
const animationsDone = async (page: Page, selector: string): Promise<void> => {
  await page
    .evaluate(async (panelSelector) => {
      const panel = [...document.querySelectorAll(`.overlay__layer ${panelSelector}`)].pop();
      if (!panel) return;
      const running = panel
        .getAnimations({ subtree: true })
        .filter((animation) =>
          Number.isFinite(Number(animation.effect?.getComputedTiming().endTime ?? Infinity)),
        );
      await Promise.race([
        Promise.all(running.map((animation) => animation.finished.catch(() => undefined))),
        new Promise((done) => setTimeout(done, 2000)),
      ]);
    }, selector)
    .catch(() => undefined);
};

/** Measures until two readings in a row pass (lists load over the network), or time runs out. */
const settle = async (page: Page, args: CheckArgs, timeout = 8_000): Promise<CheckReport> => {
  await animationsDone(page, args.panelSelector);
  const end = Date.now() + timeout;
  let passes = 0;
  let last = await page.evaluate(checkWindow, args);
  while (Date.now() < end) {
    if (last.problems.length === 0) {
      passes += 1;
      if (passes >= 2) return last;
    } else {
      passes = 0;
    }
    await page.waitForTimeout(300);
    last = await page.evaluate(checkWindow, args);
  }
  return last;
};

/** A picture of the screen in the test's report (and the CI artifact). */
const attachShot = async (page: Page, name: string): Promise<void> => {
  const body = await page.screenshot({ timeout: 15_000 }).catch(() => null);
  const file = name.replace(/[^a-z0-9+-]+/gi, "-").replace(/-+$/, "");
  if (body) await test.info().attach(`${file}.png`, { body, contentType: "image/png" });
};

const expectWindow = async (
  page: Page,
  profile: Profile,
  win: WindowCase,
  where: string,
  withItems = true,
): Promise<void> => {
  const report = await settle(page, {
    panelSelector: win.panel,
    itemSelector: withItems ? win.items : null,
    minList: settings.minList,
    minListFull: settings.minListFull,
    tolerance: TOLERANCE,
  });
  const box = report.panel
    ? `${report.panel.width}x${report.panel.height} at ${report.panel.left},${report.panel.top}`
    : "none";
  test.info().annotations.push({
    type: "layout",
    description:
      `${win.label} ${where}: window ${box}, list ${report.listHeight} px` +
      `${report.phoneLayout ? ", phone layout" : ""}${report.notes.length ? `; ${report.notes.join("; ")}` : ""}`,
  });
  if (report.problems.length > 0 || settings.allShots)
    await attachShot(page, `${profile.id}-${win.id}-${where}`);
  expect
    .soft(
      report.problems,
      `${win.label} ${where} on ${profile.label} (${profile.width}x${profile.height})`,
    )
    .toEqual([]);
};

/** Clicks through the window's first row of tabs, checking each. */
const checkTabs = async (page: Page, profile: Profile, win: WindowCase): Promise<void> => {
  const panel = page.locator(`.overlay__layer ${win.panel}`).last();
  const row = panel.locator('[role="tablist"], .tabs').filter({ visible: true }).first();
  if ((await row.count()) === 0) return;
  const tabs = row.locator('[role="tab"], .tabs__tab');
  const count = Math.min(MAX_TABS, await tabs.count());
  for (let index = 0; index < count; index += 1) {
    const tab = tabs.nth(index);
    if (!(await tab.isVisible()) || (await tab.isDisabled())) continue;
    const name = (await tab.innerText()).trim().replace(/\s+/g, " ").slice(0, 24);
    if ((await tab.getAttribute("aria-selected")) !== "true") {
      const clicked = await tab
        .click({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      expect
        .soft(clicked, `${win.label}: tab "${name}" can be pressed on ${profile.label}`)
        .toBe(true);
      if (!clicked) continue;
    }
    // A tab may be empty (an empty-state line counts as drawn), so its items are not required.
    await expectWindow(page, profile, win, `tab "${name}"`, false);
  }
};

/** What each screen's run did, attached as a summary. */
interface Tally {
  readonly checked: string[];
  readonly skipped: string[];
  readonly fixme: string[];
}

/**
 * One window's check, as a step; a thrown error is recorded and the run goes
 * on. `run` returns null when it checked the window, false when it skipped
 * and said why itself, or why there was no way in: that fails unless
 * `optional`, else the step is listed as skipped.
 */
const windowStep = async (
  page: Page,
  profile: Profile,
  win: WindowCase,
  stepId: string,
  tally: Tally,
  run: () => Promise<string | null | false>,
): Promise<void> => {
  const note = knownFailure(profile.id, stepId);
  await test.step(win.label + (stepId === win.id ? "" : ` (${stepId})`), async () => {
    if (note !== undefined) {
      tally.fixme.push(`${stepId} (${note})`);
      test.info().annotations.push({ type: "fixme", description: `${stepId}: ${note}` });
      return;
    }
    try {
      await closeAll(page);
      const yard = await yardIsUp(page);
      expect.soft(yard, `the yard is up before ${win.label} on ${profile.label}`).toBe(true);
      if (!yard) return;
      const noWayIn = await run();
      if (noWayIn === false) {
        // Skipped, and already recorded by the step itself.
      } else if (noWayIn === null) {
        tally.checked.push(stepId);
      } else if (win.optional) {
        const why = win.why ? `${noWayIn}: ${win.why}` : noWayIn;
        tally.skipped.push(`${stepId} (${why})`);
        test.info().annotations.push({ type: "skipped", description: `${stepId}: ${why}` });
      } else {
        await attachShot(page, `${profile.id}-${stepId}-no-way-in`);
        expect.soft(noWayIn, `${win.label} opens on ${profile.label}`).toBe("opened");
      }
    } catch (error) {
      await attachShot(page, `${profile.id}-${stepId}-error`);
      expect
        .soft(
          String(error instanceof Error ? error.message : error),
          `${win.label} on ${profile.label}`,
        )
        .toBe("no error");
    }
  });
};

/** The fewest World chat lines that count as a busy chat. */
const CHAT_MIN_LINES = 3;

/**
 * One test per screen, one step per window: the game boots once per screen
 * (a failed test would make Playwright start a new worker and boot again), and
 * soft checks let every window report, not just the first that breaks. A
 * known failure (knownFailures.ts) skips its step and is listed as "fixme".
 */
export const defineLayoutSuite = (profileIds: readonly string[]): void => {
  for (const profile of selectedProfiles().filter((item) => profileIds.includes(item.id))) {
    test(`${profile.id} ${profile.width}x${profile.height}: every window`, async ({
      browser,
    }) => {
      test.setTimeout(settings.bootTimeout + 12 * 60_000);
      const tally: Tally = { checked: [], skipped: [], fixme: [] };
      const game: Game = await openGame(browser, profile, test.info().parallelIndex);
      const page = game.page;
      try {
        await test.step("the game sees this screen as intended", async () => {
          const facts = await page.evaluate(pageFacts);
          test.info().annotations.push({ type: "screen", description: JSON.stringify(facts) });
          expect.soft(facts.viewport, "viewport").toBe(`${profile.width}x${profile.height}`);
          // BuildMenu and the chat pick their touch layout from (pointer: coarse);
          // if WebKit's touch emulation does not set it, the touch screens here
          // are not testing the iPad's layout at all.
          const note = knownFailure(profile.id, "screen");
          if (note !== undefined) {
            test.info().annotations.push({ type: "fixme", description: `screen: ${note}` });
            return;
          }
          expect
            .soft(
              facts.coarse,
              `(pointer: coarse) on a ${profile.touch ? "touch" : "mouse"} screen`,
            )
            .toBe(profile.touch);
        });

        for (const win of WINDOWS) {
          await windowStep(page, profile, win, win.id, tally, async () => {
            if (!(await win.open(page))) return "no way in on this screen";
            await expectWindow(page, profile, win, "as opened");
            if (win.tabs) await checkTabs(page, profile, win);
            return null;
          });
        }

        for (const id of CHAT_WINDOWS) {
          const win = WINDOWS.find((item) => item.id === id);
          if (!win) continue;
          await windowStep(page, profile, win, `${win.id}+chat`, tally, async () => {
            const said = await fillWorldChat(page);
            test.info().annotations.push({ type: "chat", description: said });
            if (said.startsWith("no World chat")) {
              tally.skipped.push(`${win.id}+chat (${said})`);
              return false;
            }
            expect
              .soft(await chatLines(page), `World chat lines on ${profile.label}`)
              .toBeGreaterThanOrEqual(CHAT_MIN_LINES);
            if (!(await win.open(page))) return "no way in on this screen";
            await expectWindow(page, profile, win, "with World chat full");
            return null;
          });
        }
        await closeAll(page);
        await closeWorldChat(page);

        // Last: a blind tap on the yard may leave a building picked up.
        const building: WindowCase = {
          id: "building",
          label: "Building side panel",
          panel: ".building-panel",
          items: null,
          optional: true,
          tabs: false,
          open: async () => true,
        };
        await windowStep(page, profile, building, building.id, tally, async () => {
          if (!(await tapYardMiddle(page, profile))) {
            return "no building under the middle of the screen (the yard is a canvas; the tap is blind)";
          }
          await expectWindow(page, profile, building, "as opened");
          return null;
        });
      } finally {
        test.info().annotations.push({
          type: "summary",
          description:
            `checked ${tally.checked.length}: ${tally.checked.join(", ") || "none"}` +
            ` | skipped ${tally.skipped.length}: ${tally.skipped.join(", ") || "none"}` +
            ` | fixme ${tally.fixme.length}: ${tally.fixme.join(", ") || "none"}`,
        });
        await game.context.close();
      }
    });
  }
};
