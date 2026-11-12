import { Panel } from "@/ui/Panel";

/**
 * The yard picture's window (owner, 2026-11-11): the picture, a line that
 * says the traps are not in it, and Save and Copy, for the Discord
 * yard-showcase channel. Copy shows only where the browser can put a picture
 * on the clipboard.
 *
 * The picture itself is made by `YardRenderer.snapshot` and
 * `snapshotPicture.ts`; this only shows it and hands it over.
 */

/** The clipboard calls Copy needs; the browser's own by default. */
export interface PictureClipboard {
  write(blob: Promise<Blob>): Promise<void>;
}

/**
 * The browser's clipboard, or null where it cannot take a picture. The item
 * is given the PNG as a promise, which Safari needs to count the press as
 * the reason for the write.
 */
export const browserClipboard = (): PictureClipboard | null => {
  if (typeof navigator === "undefined" || typeof navigator.clipboard?.write !== "function") return null;
  if (typeof ClipboardItem === "undefined") return null;
  return {
    write: (blob) => navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]),
  };
};

export interface YardSnapshotPanelOptions {
  /** The PNG, or null when the picture could not be drawn. */
  picture: Promise<Blob> | null;
  /** What Save names the file (`snapshotFileName`). */
  fileName: string;
  onClose: () => void;
  /** Defaults to {@link browserClipboard}; null hides Copy. */
  clipboard?: PictureClipboard | null;
  /** Makes the preview's address; `URL.createObjectURL` by default. */
  urlFor?: (blob: Blob) => string;
  /** Lets an address go once the window closes; `URL.revokeObjectURL` by default. */
  revoke?: (url: string) => void;
}

const button = (label: string, className: string): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
};

/** How long Copy says "Copied" before it reads Copy again. */
const COPIED_MS = 2000;

export const yardSnapshotPanel = (options: YardSnapshotPanelOptions): Panel => {
  const urlFor = options.urlFor ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revoke = options.revoke ?? ((url: string) => URL.revokeObjectURL(url));
  let url: string | null = null;
  let closed = false;
  const panel = new Panel({
    title: "Yard picture",
    className: "map-panel planner-snapshot",
    onClose: () => {
      closed = true;
      if (url) revoke(url);
      url = null;
      options.onClose();
    },
  });

  const frame = document.createElement("div");
  frame.className = "planner-snapshot__frame";
  frame.setAttribute("aria-busy", "true");

  const note = document.createElement("p");
  note.className = "planner-snapshot__note u-muted";
  note.textContent = "Traps hidden";

  const save = button("Save", "btn btn--primary");
  save.disabled = true;
  const clipboard = options.clipboard === undefined ? browserClipboard() : options.clipboard;
  const copy = button("Copy", "btn btn--ghost");
  copy.disabled = true;
  copy.hidden = clipboard === null;
  copy.title = "Copy the picture, to paste into Discord";
  save.title = "Save the picture as a PNG file";

  const actions = document.createElement("div");
  actions.className = "planner-apply__actions planner-snapshot__actions";
  actions.append(copy, save);

  const failed = (): void => {
    frame.removeAttribute("aria-busy");
    frame.classList.add("planner-snapshot__frame--failed");
    frame.textContent = "Couldn't take the picture. Try again.";
    note.hidden = true;
    actions.hidden = true;
  };

  if (!options.picture) {
    failed();
  } else {
    const picture = options.picture;
    picture.then(
      (blob) => {
        if (closed) return;
        url = urlFor(blob);
        const image = document.createElement("img");
        image.className = "planner-snapshot__image";
        image.alt = "Your yard, with no traps in it";
        image.src = url;
        frame.removeAttribute("aria-busy");
        frame.replaceChildren(image);
        save.disabled = false;
        copy.disabled = false;
      },
      () => {
        if (!closed) failed();
      },
    );

    save.addEventListener("click", () => {
      if (!url) return;
      const link = document.createElement("a");
      link.href = url;
      link.download = options.fileName;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
    });

    let reset: number | undefined;
    copy.addEventListener("click", () => {
      if (!clipboard) return;
      window.clearTimeout(reset);
      copy.disabled = true;
      clipboard.write(picture).then(
        () => {
          copy.textContent = "Copied";
        },
        () => {
          copy.textContent = "Copy failed";
        },
      ).finally(() => {
        copy.disabled = false;
        reset = window.setTimeout(() => {
          copy.textContent = "Copy";
        }, COPIED_MS);
      });
    });
  }

  panel.setContent(frame, note, actions);
  return panel;
};
