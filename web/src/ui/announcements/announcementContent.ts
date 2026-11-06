/**
 * An announcement's pictures and words, as the game's pop-up and the
 * dashboard's preview both draw them (`AnnouncementDialog.ts`,
 * `admin/announcements.ts`), so the preview is what players will see.
 *
 * The words are the owner's plain text: put on the page as text, never as
 * HTML. A blank line starts a new paragraph, a single line break stays a line
 * break, and only `http://` and `https://` addresses become links, which open
 * in a new tab.
 */

export type TextPiece =
  | { readonly text: string }
  | { readonly text: string; readonly href: string };

const ADDRESS = /https?:\/\/[^\s<>"']+/g;
/** Punctuation that ends a sentence rather than an address. */
const TRAILING = /[.,;:!?)\]}'"]+$/;

/** A web address as a link target, or null for anything that is not one. */
export const safeHref = (raw: string): string | null => {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};

/** One line cut into text and links. */
export const linkPieces = (line: string): TextPiece[] => {
  const pieces: TextPiece[] = [];
  let at = 0;
  for (const match of line.matchAll(ADDRESS)) {
    const start = match.index;
    const address = match[0].replace(TRAILING, "");
    const href = safeHref(address);
    if (!href) continue;
    if (start > at) pieces.push({ text: line.slice(at, start) });
    pieces.push({ text: address, href });
    at = start + address.length;
  }
  if (at < line.length) pieces.push({ text: line.slice(at) });
  return pieces;
};

/** The text's paragraphs, each its lines. */
export const paragraphsOf = (body: string): string[][] =>
  body
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .map((paragraph) => paragraph.split("\n").map((line) => line.trim()));

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  return element;
};

/** The words as paragraphs with links. */
export const announcementText = (body: string): HTMLElement => {
  const box = el("div", "announcement__text");
  for (const lines of paragraphsOf(body)) {
    const paragraph = el("p", "announcement__paragraph");
    lines.forEach((line, index) => {
      if (index > 0) paragraph.append(document.createElement("br"));
      for (const piece of linkPieces(line)) {
        if ("href" in piece) {
          const link = el("a", "announcement__link");
          link.href = piece.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = piece.text;
          paragraph.append(link);
        } else {
          paragraph.append(document.createTextNode(piece.text));
        }
      }
    });
    box.append(paragraph);
  }
  return box;
};

/** The pictures (by their addresses) above the words. */
export const announcementContent = (body: string, images: readonly string[]): HTMLElement => {
  const box = el("div", "announcement");
  for (const src of images) {
    const picture = el("div", "announcement__picture");
    const image = el("img", "announcement__image");
    image.src = src;
    image.alt = "";
    image.decoding = "async";
    // A picture that fails to load leaves nothing rather than a broken-image icon.
    image.addEventListener("error", () => picture.remove(), { once: true });
    picture.append(image);
    box.append(picture);
  }
  box.append(announcementText(body));
  return box;
};
