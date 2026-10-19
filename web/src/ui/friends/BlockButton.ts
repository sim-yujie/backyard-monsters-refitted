/**
 * A Block button with a confirm, for the friends rows and Find results
 * (friends WP9, issue #376). The first press asks, the second blocks, as the
 * mail thread's Block player does. Blocking is the server's rule
 * (`docs/design/friends.md` §3.6): it ends any friendship or request between
 * the two and stops requests, gifts and messages from them.
 */

import { blockPlayer } from "@/api/privacy";
import { settingsFailure } from "@/ui/AccountSettings";

export const BLOCK_TEXT = {
  ask: "Block",
  question: (name: string) => `Block ${name}? They cannot send you requests, gifts or messages.`,
  confirm: "Block",
  cancel: "Cancel",
  done: (name: string) => `${name} is blocked.`,
} as const;

export interface BlockButtonOptions {
  readonly userid: number;
  readonly username: string;
  /** Called once the server has blocked them, so the row can go. */
  readonly onBlocked?: (userid: number) => void;
  /** Called with a sentence when the block failed. */
  readonly onError?: (message: string) => void;
  /** Swappable for tests. */
  readonly block?: (userid: number) => Promise<void>;
}

const button = (className: string, label: string, onClick: () => void): HTMLButtonElement => {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.textContent = label;
  el.addEventListener("click", onClick);
  return el;
};

export const blockButton = (options: BlockButtonOptions): HTMLElement => {
  const root = document.createElement("span");
  root.className = "block-button";
  const block = options.block ?? blockPlayer;

  const ask = button("btn btn--ghost block-button__ask", BLOCK_TEXT.ask, () => {
    ask.hidden = true;
    confirm.hidden = false;
    yes.focus();
  });
  const confirm = document.createElement("span");
  confirm.className = "block-button__confirm";
  confirm.hidden = true;
  const question = document.createElement("span");
  question.className = "block-button__question";
  question.textContent = BLOCK_TEXT.question(options.username);
  const yes = button("btn btn--danger block-button__yes", BLOCK_TEXT.confirm, () => {
    yes.disabled = true;
    no.disabled = true;
    block(options.userid).then(
      () => {
        confirm.hidden = true;
        question.textContent = BLOCK_TEXT.done(options.username);
        root.replaceChildren(question);
        options.onBlocked?.(options.userid);
      },
      (caught: unknown) => {
        yes.disabled = false;
        no.disabled = false;
        options.onError?.(settingsFailure(caught));
      },
    );
  });
  const no = button("btn btn--ghost block-button__no", BLOCK_TEXT.cancel, () => {
    confirm.hidden = true;
    ask.hidden = false;
    ask.focus();
  });
  confirm.append(question, yes, no);
  root.append(ask, confirm);
  return root;
};
