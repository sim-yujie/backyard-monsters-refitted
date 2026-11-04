import { getSession } from "@/api/auth";
import { postJson } from "@/api/http";
import type { ApiEnvelope } from "@/api/types";
import { savedClassicLook, savedMusicChoice, type MusicChoice } from "@/game/classicLook";
import { quality, type Quality } from "@/game/quality";
import { savedFontChoice, type FontChoice } from "@/ui/fontChoice";

/**
 * Tells the server which look the player uses (owner, 4 Nov 2026: "can we log
 * down which players are using modern vs classic for beta6? would be nice to
 * know"). The choices stay in the browser as before; this only copies them to
 * the player's account for the owner's dashboard (server
 * `services/user/lookReport.ts`). The player sees nothing.
 *
 * Sent after the own main yard loads, and again whenever Account settings
 * changes one of them. The same choices are sent at most once an hour.
 */
const LOOK_PATH = "/api/:apiVersion/player/look";

export interface LookChoices {
  readonly style: "modern" | "classic";
  readonly music: MusicChoice;
  readonly quality: Quality;
  readonly font: FontChoice;
}

/** The choices as saved in this browser: what the game uses from the next load on. */
export const currentLook = (): LookChoices => ({
  style: savedClassicLook() ? "classic" : "modern",
  music: savedMusicChoice(),
  quality: quality(),
  font: savedFontChoice(),
});

export type LookSender = (look: LookChoices) => Promise<unknown>;

const sendLook: LookSender = (look) => postJson<ApiEnvelope>(LOOK_PATH, { ...look });

/** An unchanged look is sent again after this long, so a tab left open for days still counts as seen. */
export const LOOK_RESEND_MS = 60 * 60 * 1000;

/** The account and choices last sent in this tab, and when, so an unchanged look is not sent again. */
let lastSent: string | null = null;
let lastSentAt = 0;

/**
 * Sends the current choices unless this tab sent the same ones within the hour. A
 * failed send is forgotten, so the next yard load or change tries again; it
 * never shows the player anything.
 */
export const reportLook = (
  send: LookSender = sendLook,
  look: LookChoices = currentLook(),
  account: number = getSession()?.userId ?? 0,
  now: number = Date.now(),
): void => {
  const key = JSON.stringify([account, look]);
  if (key === lastSent && now - lastSentAt < LOOK_RESEND_MS) return;
  lastSent = key;
  lastSentAt = now;
  void send(look).catch(() => {
    if (lastSent === key) lastSent = null;
  });
};

/** Tests only: forget what was sent. */
export const resetLookReport = (): void => {
  lastSent = null;
  lastSentAt = 0;
};
