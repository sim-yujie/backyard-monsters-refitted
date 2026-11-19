import { yardSheetsIdle } from "@/game/attack/sheetQueue";
import { monsterSheetLevel } from "@/game/quality";
import { quietLogin } from "@/game/quietLogin";
import { watchYardLoad } from "@/game/safeMode";

/**
 * A yard is about to be drawn: this page load is marked for safe mode
 * (`safeMode.ts`), at the level its monsters are drawn at, and counts as fine
 * once the page has been on screen for 30 s with the yard's sheets all in.
 * Only the first yard of a page load does anything.
 *
 * Marked here, not at page boot, so the login page never counts as a load
 * that died. Not on a test server's quiet login: a test browser is closed
 * without a word seconds after it opens, which would look like a crash.
 */
export const noteYardLoading = (): void => {
  if (quietLogin()) return;
  watchYardLoad(() => monsterSheetLevel(), yardSheetsIdle);
};
