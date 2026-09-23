/**
 * The HTML overlay that sits above the Pixi canvas.
 *
 * Menus, popups and the HUD are DOM rather than canvas because they need real
 * text input, scrolling, focus order and screen-reader semantics, none of which
 * are worth reimplementing in WebGL.
 *
 * The overlay covers the canvas, so it has `pointer-events: none` and every
 * child element opts back in. That way a click on empty space falls through to
 * the camera underneath instead of being eaten by an invisible div.
 */

export interface Overlay {
  /** The element the overlay lives in. */
  readonly root: HTMLElement;
  /** Ordinary panels, the HUD and scene chrome. */
  readonly content: HTMLElement;
  /** Modal popups, stacked above `content`. */
  readonly modal: HTMLElement;
  /** Removes everything from both layers. */
  clear(): void;
  /** Removes the overlay from the document. */
  destroy(): void;
}

const div = (className: string): HTMLDivElement => {
  const element = document.createElement("div");
  element.className = className;
  return element;
};

/** Builds the overlay and attaches it to `parent`. */
export const createOverlay = (parent: HTMLElement): Overlay => {
  const root = div("overlay");

  const content = div("overlay__layer");
  const modal = div("overlay__layer overlay__layer--modal");

  root.append(content, modal);
  parent.append(root);

  return {
    root,
    content,
    modal,
    clear() {
      content.replaceChildren();
      modal.replaceChildren();
    },
    destroy() {
      root.remove();
    },
  };
};
