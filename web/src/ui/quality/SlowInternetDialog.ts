import { Popup } from "@/ui/Popup";

/**
 * The one-time "Slow internet?" suggestion (`game/slowInternet.ts`): Low
 * quality, or keep what the player has. The game never switches by itself;
 * closing it keeps High, and Account settings can change it later.
 */

export const SLOW_TEXT = {
  title: "Slow internet?",
  body: "Low quality loads the game faster: lighter monsters, music off. You can change it in Account settings.",
  useLow: "Use Low",
  keep: "Keep High",
} as const;

export interface SlowInternetDialogOptions {
  /** Where the popup mounts: the modal layer. */
  readonly container: HTMLElement;
  /** "Use Low" was pressed. */
  readonly onLow: () => void;
}

export const openSlowInternet = (options: SlowInternetDialogOptions): Popup => {
  const popup = new Popup({ title: SLOW_TEXT.title, className: "slow-internet-popup", closeOnBackdrop: false });
  const body = document.createElement("div");
  body.className = "slow-internet";
  const words = document.createElement("p");
  words.textContent = SLOW_TEXT.body;
  const foot = document.createElement("div");
  foot.className = "slow-internet__foot";
  const low = document.createElement("button");
  low.type = "button";
  low.className = "btn btn--primary";
  low.textContent = SLOW_TEXT.useLow;
  low.addEventListener("click", () => {
    options.onLow();
    popup.close();
  });
  const keep = document.createElement("button");
  keep.type = "button";
  keep.className = "btn btn--ghost";
  keep.textContent = SLOW_TEXT.keep;
  keep.addEventListener("click", () => popup.close());
  foot.append(low, keep);
  body.append(words, foot);
  popup.setContent(body).mount(options.container);
  return popup;
};
