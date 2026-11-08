import type { LatestMail } from "@/api/mail";
import { icon } from "@/ui/icons";
import "@/ui/styles/mail.css";

/**
 * The live mail pop-up (owner, beta 7): a small card under the HUD when a
 * message arrives, the envelope, who sent it (with the light blue Mod badge
 * for a moderator) and its first words. Pressing it opens the message; ×
 * puts it away; it goes by itself after {@link TOAST_MS}. No sound: the game
 * plays none for mail.
 */

/** How long the pop-up stays. */
export const TOAST_MS = 8_000;

/** The pop-up's two lines: who, and the first words (the subject when the message has none). */
export const toastText = (mail: LatestMail): { who: string; text: string } => ({
  who: mail.name || `Player ${mail.from}`,
  text: mail.preview || mail.subject,
});

export class MailToast {
  readonly element: HTMLElement;

  private readonly open: HTMLButtonElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onOpen: (() => void) | null = null;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "mail-toast";
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-live", "polite");
    this.element.hidden = true;

    this.open = document.createElement("button");
    this.open.type = "button";
    this.open.className = "mail-toast__open";
    this.open.addEventListener("click", () => {
      const onOpen = this.onOpen;
      this.hide();
      onOpen?.();
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "mail-toast__close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss");
    close.addEventListener("click", () => this.hide());

    this.element.append(this.open, close);
  }

  /** Shows `mail`; pressing it calls `onOpen`. A newer one replaces it. */
  show(mail: LatestMail, onOpen: () => void): void {
    const { who, text } = toastText(mail);
    const icons = document.createElement("span");
    icons.className = "mail-toast__icon";
    icons.append(icon("mail", 26));
    const body = document.createElement("span");
    body.className = "mail-toast__body";
    const name = document.createElement("span");
    name.className = "mail-toast__who";
    if (mail.mod) name.append(modBadge());
    name.append(who);
    const words = document.createElement("span");
    words.className = "mail-toast__text";
    words.textContent = text;
    body.append(name, words);
    this.open.replaceChildren(icons, body);
    this.open.setAttribute("aria-label", `New mail from ${mail.mod ? "moderator " : ""}${who}: ${text}. Open it`);
    this.element.classList.toggle("mail-toast--mod", mail.mod);
    this.onOpen = onOpen;
    this.element.hidden = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), TOAST_MS);
  }

  hide(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.onOpen = null;
    this.element.hidden = true;
  }

  get isShown(): boolean {
    return !this.element.hidden;
  }

  destroy(): void {
    this.hide();
    this.element.remove();
  }
}

/** The light blue Mod badge, as chat shows it, for mail. */
export const modBadge = (): HTMLElement => {
  const badge = document.createElement("span");
  badge.className = "mail-mod";
  badge.textContent = "Mod";
  badge.title = "Moderator";
  return badge;
};
