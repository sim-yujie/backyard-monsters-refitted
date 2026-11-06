import { localWhen, type ModerationNotice } from "@/api/moderation";
import { Popup } from "@/ui/Popup";
import "./teamNotice.css";

/**
 * A warning or a chat pause from the game team, as a pop-up in the yard
 * (`game/yard/plugins/teamNotice.ts`): the game team's words, for a pause
 * until when, and OK. It must be answered: no scrim or Escape close.
 */

/** The popup's class: what a test or the plugin looks for. */
export const TEAM_NOTICE_CLASS = "team-notice-popup";

export const TEAM_NOTICE_TITLES = {
  warn: "Warning from the game team",
  mute: "Chat paused",
} as const;

export interface TeamNoticeOptions {
  readonly container: HTMLElement;
  readonly notice: Pick<ModerationNotice, "kind" | "text" | "until">;
  /** Called once when OK is pressed. */
  readonly onClose: () => void;
}

export const openTeamNotice = (options: TeamNoticeOptions): Popup => {
  const { notice } = options;
  const popup = new Popup({
    title: TEAM_NOTICE_TITLES[notice.kind],
    className: TEAM_NOTICE_CLASS,
    dismissable: false,
    onClose: options.onClose,
  });
  const body = document.createElement("div");
  body.className = `team-notice team-notice--${notice.kind}`;

  const badge = document.createElement("span");
  badge.className = "team-notice__badge";
  badge.textContent = "GM";
  badge.title = "The game team";

  const text = document.createElement("p");
  text.className = "team-notice__text";
  text.textContent = notice.text;

  const head = document.createElement("div");
  head.className = "team-notice__head";
  head.append(badge, text);
  body.append(head);

  if (notice.kind === "mute" && notice.until) {
    const until = document.createElement("p");
    until.className = "team-notice__until";
    until.textContent = `You can chat again ${localWhen(notice.until)}.`;
    body.append(until);
  }

  const done = document.createElement("button");
  done.type = "button";
  done.className = "btn btn--primary team-notice__done";
  done.textContent = "OK";
  done.addEventListener("click", () => popup.close());
  const foot = document.createElement("div");
  foot.className = "team-notice__foot";
  foot.append(done);
  body.append(foot);

  popup.setContent(body).mount(options.container);
  done.focus({ preventScroll: true });
  return popup;
};
