import { announcementImageUrl, type Announcement } from "@/api/announcements";
import { Popup } from "@/ui/Popup";
import { announcementContent } from "./announcementContent";
import "./announcements.css";

/**
 * The owner's announcements in the game: the pop-up that shows one after the
 * yard loads (`game/announcements/announcementQueue.ts` decides when), and
 * the Account menu's "News", which shows every current one again.
 *
 * The scrim does not close the pop-up, so a stray tap on a phone does not
 * skip it; "Got it", the close button and Escape all do.
 */

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

/** The popup's class: what {@link isAnnouncementOpen} looks for. */
const POPUP_CLASS = "announcement-popup";

export const isAnnouncementOpen = (): boolean =>
  document.querySelector(`.${POPUP_CLASS}`) !== null;

export interface AnnouncementDialogOptions {
  /** Where the popup mounts: the modal layer. */
  readonly container: HTMLElement;
  readonly announcement: Pick<Announcement, "title" | "body" | "imageIds">;
  /** Which one of how many waiting, shown as "1 / 2" when there is more than one. */
  readonly step?: { readonly index: number; readonly total: number };
  /** A picture's address; the game's public picture route by default. */
  readonly imageUrl?: (id: number) => string;
  /** Called once when it closes, however it closes. */
  readonly onClose?: () => void;
}

/** Opens one announcement with its "Got it". */
export const openAnnouncement = (options: AnnouncementDialogOptions): Popup => {
  const { announcement } = options;
  const imageUrl = options.imageUrl ?? announcementImageUrl;
  const popup = new Popup({
    title: announcement.title,
    className: POPUP_CLASS,
    closeOnBackdrop: false,
    ...(options.onClose && { onClose: options.onClose }),
  });
  const body = el("div", "announcement-dialog");
  body.append(announcementContent(announcement.body, announcement.imageIds.map(imageUrl)));
  const foot = el("div", "announcement-dialog__foot");
  if (options.step && options.step.total > 1) {
    const count = el(
      "span",
      "announcement-dialog__step",
      `${options.step.index + 1} / ${options.step.total}`,
    );
    count.setAttribute("aria-label", `${options.step.index + 1} of ${options.step.total}`);
    foot.append(count);
  }
  const done = el("button", "btn btn--primary announcement-dialog__done", "Got it");
  done.type = "button";
  done.addEventListener("click", () => popup.close());
  foot.append(done);
  body.append(foot);
  popup.setContent(body).mount(options.container);
  // Without scrolling: the button is at the foot and the picture must show.
  done.focus({ preventScroll: true });
  return popup;
};

export interface NewsOptions {
  readonly container: HTMLElement;
  /** Reads the current announcements. */
  readonly load: () => Promise<readonly Announcement[]>;
  readonly imageUrl?: (id: number) => string;
  /** Called with the ones shown that the player had not pressed "Got it" on. */
  readonly onSeen?: (ids: number[]) => void;
}

const NEWS_CLASS = "announcement-popup announcement-news";

/** The Account menu's "News": every current announcement, newest first. */
export const openNews = (options: NewsOptions): Popup => {
  const imageUrl = options.imageUrl ?? announcementImageUrl;
  const popup = new Popup({ title: "News", className: NEWS_CLASS });
  const body = el("div", "announcement-news__list");
  body.setAttribute("aria-busy", "true");
  body.append(el("p", "announcement-news__note", "Loading…"));
  popup.setContent(body).mount(options.container);

  void options.load().then(
    (list) => {
      body.replaceChildren();
      body.removeAttribute("aria-busy");
      if (list.length === 0) {
        body.append(el("p", "announcement-news__note", "No news right now."));
        return;
      }
      for (const item of list) {
        const article = el("article", "announcement-news__item");
        article.append(
          el("h3", "announcement-news__title", item.title),
          announcementContent(item.body, item.imageIds.map(imageUrl)),
        );
        body.append(article);
      }
      const unseen = list.filter((item) => !item.dismissed).map((item) => item.id);
      if (unseen.length > 0) options.onSeen?.(unseen);
    },
    () => {
      body.replaceChildren(
        el(
          "p",
          "announcement-news__note",
          "Could not load the news. Check your connection and try again.",
        ),
      );
      body.removeAttribute("aria-busy");
    },
  );
  return popup;
};
