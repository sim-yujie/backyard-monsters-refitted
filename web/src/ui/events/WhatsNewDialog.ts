import { CHANGELOG, type ChangelogCard, type ChangelogRelease } from "@/data/changelog";
import { Popup } from "@/ui/Popup";
import "./whats-new.css";

/**
 * The "What's new" cards: a picture, a title and a line or two per change in
 * the newest release, older releases folded underneath. It pops up once after
 * an update (`game/events/whatsNew.ts` decides) and opens again from the
 * Account menu's "What's new" item. The words and pictures live in
 * `web/src/data/changelog/`, one file per release.
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

const card = (item: ChangelogCard): HTMLElement => {
  const box = el("li", "whats-new__card");
  const picture = el("div", "whats-new__picture");
  const image = el("img", "whats-new__image");
  image.src = item.image;
  image.alt = "";
  image.decoding = "async";
  image.loading = "lazy";
  // A missing picture leaves the coloured frame rather than a broken-image icon.
  image.addEventListener("error", () => image.remove(), { once: true });
  picture.append(image);
  box.append(picture, el("h4", "whats-new__title", item.title), el("p", "whats-new__text", item.text));
  return box;
};

const cardList = (release: ChangelogRelease): HTMLElement => {
  const list = el("ul", "whats-new__cards");
  list.append(...release.cards.map(card));
  return list;
};

export interface WhatsNewOptions {
  /** Where the popup mounts: the modal layer. */
  readonly container: HTMLElement;
  /** The releases, newest first; the shipped list by default. */
  readonly releases?: readonly ChangelogRelease[];
  readonly onClose?: () => void;
}

/** Opens the cards; returns the popup, or null when there is nothing to show. */
export const openWhatsNew = (options: WhatsNewOptions): Popup | null => {
  const [latest, ...older] = options.releases ?? CHANGELOG;
  if (!latest) return null;
  const popup = new Popup({
    title: "What's new",
    className: "whats-new-popup",
    ...(options.onClose && { onClose: options.onClose }),
  });
  const body = el("div", "whats-new");
  body.append(el("p", "whats-new__release", latest.title), cardList(latest));
  for (const release of older) {
    const details = el("details", "whats-new__older");
    details.append(el("summary", "whats-new__older-summary", release.title), cardList(release));
    body.append(details);
  }
  const done = el("button", "btn btn--primary whats-new__done", "Let's play!");
  done.type = "button";
  done.addEventListener("click", () => popup.close());
  body.append(done);
  popup.setContent(body).mount(options.container);
  // Without scrolling: the button is at the foot and the first card must show.
  done.focus({ preventScroll: true });
  return popup;
};

/** The modal layer the dialog mounts in, as Account settings finds it. */
export const modalLayer = (): HTMLElement =>
  document.querySelector<HTMLElement>(".overlay__layer--modal") ?? document.body;
