import { KOFI_URL, PATREON_URL } from "@/config";
import { gameIcon } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import "./support.css";

/**
 * "Support the game" (owner 24 Oct 2026; built 4 Nov): one line on why, a
 * Patreon button (monthly) and a Ko-fi button (one-time tip). It opens from
 * the Account menu's heart item, and, rarely, by itself as a reminder
 * (`game/support/supportReminder.ts`), which adds "Maybe later" and "Don't
 * show again". The "What's new" cards end with the same two links
 * ({@link supportLine}).
 *
 * Nothing here gives anything in the game: the links only open the owner's
 * pages in a new tab. Plain, friendly words; no guilt.
 */

export const SUPPORT_TEXT = {
  title: "Support the game",
  why: "Free, no ads, made by one person. Donations pay for the server.",
  patreon: "Patreon",
  patreonNote: "Monthly",
  kofi: "Ko-fi",
  kofiNote: "One-time tip",
  thanks: "Thank you!",
  whatsNew: "Free, no ads, made by one person. Want to help?",
  later: "Maybe later",
  never: "Don't show again",
} as const;

/** The popup's class: Bob's tips and the reminder look for it. */
export const SUPPORT_POPUP_CLASS = "support-popup";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

/** One outside link styled as a button, opened in a new tab with no referrer. */
const link = (href: string, label: string, note: string | null, className: string): HTMLAnchorElement => {
  const anchor = el("a", className);
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.append(el("span", "support__link-label", label));
  if (note) anchor.append(el("span", "support__link-note", note));
  return anchor;
};

/** The two buttons: Patreon (monthly) first, Ko-fi (one-time tip) second. */
export const supportLinks = (options: { readonly notes?: boolean } = {}): HTMLElement => {
  const notes = options.notes ?? true;
  const row = el("div", "support__links");
  const patreon = link(
    PATREON_URL,
    SUPPORT_TEXT.patreon,
    notes ? SUPPORT_TEXT.patreonNote : null,
    "btn btn--primary support__link support__link--patreon",
  );
  const kofi = link(
    KOFI_URL,
    SUPPORT_TEXT.kofi,
    notes ? SUPPORT_TEXT.kofiNote : null,
    "btn btn--outline support__link support__link--kofi",
  );
  row.append(patreon, kofi);
  return row;
};

/** The big painted heart at the top of the panel (`public/ui/support/`). */
const heart = (): HTMLImageElement => {
  const base = `${import.meta.env.BASE_URL}ui/support/heart`;
  const image = el("img", "support__heart");
  image.src = `${base}-128.webp`;
  image.srcset = `${base}-128.webp 128w, ${base}-256.webp 256w`;
  image.sizes = "72px";
  image.width = 72;
  image.height = 72;
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  image.decoding = "async";
  image.draggable = false;
  return image;
};

/** "Maybe later" and "Don't show again", the reminder's own answers. */
export interface SupportReminderAnswers {
  /** "Maybe later", the close button, Escape or the scrim. */
  readonly onLater: () => void;
  /** "Don't show again". */
  readonly onNever: () => void;
}

export interface SupportPanelOptions {
  /** Where the popup mounts: the modal layer. */
  readonly container: HTMLElement;
  /** With these it is the reminder: the two answers sit under the links. */
  readonly reminder?: SupportReminderAnswers;
}

/** Opens the panel; returns the popup. */
export const openSupportPanel = (options: SupportPanelOptions): Popup => {
  const reminder = options.reminder;
  let answered = false;
  const popup = new Popup({
    title: SUPPORT_TEXT.title,
    className: reminder ? `${SUPPORT_POPUP_CLASS} support-popup--reminder` : SUPPORT_POPUP_CLASS,
    onClose: () => {
      // Closed any other way than "Don't show again": that is "Maybe later".
      if (reminder && !answered) {
        answered = true;
        reminder.onLater();
      }
    },
  });

  const body = el("div", "support");
  const why = el("p", "support__why", SUPPORT_TEXT.why);
  body.append(heart(), why, supportLinks());

  if (reminder) {
    const answers = el("div", "support__answers");
    const later = el("button", "btn support__later", SUPPORT_TEXT.later);
    later.type = "button";
    later.addEventListener("click", () => popup.close());
    const never = el("button", "btn btn--ghost support__never", SUPPORT_TEXT.never);
    never.type = "button";
    never.addEventListener("click", () => {
      answered = true;
      reminder.onNever();
      popup.close();
    });
    answers.append(later, never);
    body.append(answers);
  } else {
    body.append(el("p", "support__thanks", SUPPORT_TEXT.thanks));
  }

  popup.setContent(body).mount(options.container);
  return popup;
};

/** Whether the panel is up (the reminder waits while it, or any popup, is). */
export const isSupportOpen = (): boolean => document.querySelector(`.${SUPPORT_POPUP_CLASS}`) !== null;

/**
 * The support line at the foot of the "What's new" cards: the small heart,
 * one short line and the same two buttons, without their notes.
 */
export const supportLine = (): HTMLElement => {
  const box = el("div", "support-line");
  const text = el("p", "support-line__text");
  text.append(gameIcon("support", { size: 24, decorative: true, className: "support-line__icon" }));
  text.append(el("span", "support-line__words", SUPPORT_TEXT.whatsNew));
  box.append(text, supportLinks({ notes: false }));
  return box;
};
