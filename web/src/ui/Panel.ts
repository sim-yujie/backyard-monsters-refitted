/**
 * A framed box with a title bar, an optional close button and a body slot.
 *
 * Panel is the plain, non-modal primitive: it does not trap focus and does not
 * dim what is behind it. Popup builds the modal behaviour on top of it.
 */

export interface PanelOptions {
  title: string;
  /** Shows a close button in the title bar. Defaults to true. */
  closable?: boolean;
  /** Also close when Escape is pressed while focus is inside the panel. */
  closeOnEscape?: boolean;
  /** Extra class names on the panel element. */
  className?: string;
  /** Called after the panel removes itself. */
  onClose?: () => void;
}

export class Panel {
  readonly element: HTMLElement;
  /** Put your content in here. */
  readonly body: HTMLElement;
  readonly titlebar: HTMLElement;

  private readonly titleElement: HTMLElement;
  private readonly onClose: (() => void) | undefined;
  private readonly closeOnEscape: boolean;
  private closed = false;

  constructor(options: PanelOptions) {
    this.onClose = options.onClose;
    this.closeOnEscape = options.closeOnEscape ?? false;

    this.element = document.createElement("section");
    this.element.className = options.className ? `panel ${options.className}` : "panel";

    this.titlebar = document.createElement("header");
    this.titlebar.className = "panel__titlebar";

    this.titleElement = document.createElement("h2");
    this.titleElement.className = "panel__title";
    this.titleElement.textContent = options.title;

    // Ties the panel to its heading for assistive technology.
    const titleId = `panel-title-${Math.random().toString(36).slice(2, 9)}`;
    this.titleElement.id = titleId;
    this.element.setAttribute("aria-labelledby", titleId);

    this.titlebar.append(this.titleElement);

    if (options.closable ?? true) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "btn btn--ghost btn--icon";
      close.setAttribute("aria-label", "Close");
      close.textContent = "×";
      close.addEventListener("click", () => this.close());
      this.titlebar.append(close);
    }

    this.body = document.createElement("div");
    this.body.className = "panel__body";

    this.element.append(this.titlebar, this.body);

    if (this.closeOnEscape) {
      this.element.addEventListener("keydown", this.handleKeydown);
    }
  }

  /** Replaces the body contents. */
  setContent(...nodes: (Node | string)[]): this {
    this.body.replaceChildren(...nodes);
    return this;
  }

  setTitle(title: string): this {
    this.titleElement.textContent = title;
    return this;
  }

  /** Adds the panel to a container. */
  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /** Removes the panel and fires `onClose` once. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.element.removeEventListener("keydown", this.handleKeydown);
    this.element.remove();
    this.onClose?.();
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    this.close();
  };
}
