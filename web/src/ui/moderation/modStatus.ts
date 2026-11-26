import { MOD_BAN_DAYS, type ModStatus } from "@/api/modReports";

/**
 * Whether the signed-in player is a moderator, as the Reports door last read
 * it (`GET /mod/status`, `ReportsDoor.ts`), so the chat box can offer Ban on
 * a name (owner, 24 Nov 2026) without asking the server again. The server
 * checks every step itself; this only decides what is shown.
 */

let moderator = false;
let days: readonly number[] = MOD_BAN_DAYS;

export const setModStatus = (status: Pick<ModStatus, "moderator" | "banDays">): void => {
  moderator = status.moderator;
  days = status.banDays && status.banDays.length ? status.banDays : MOD_BAN_DAYS;
};

export const isModerator = (): boolean => moderator;

/** Ban lengths a moderator may pick, in days. */
export const modBanDays = (): readonly number[] => days;
