/** A tiny element builder for the owner dashboard: text goes in as text, never as HTML. */

export type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  /** Attributes set as they are (`href`, `type`, `aria-label`...). */
  attrs?: Record<string, string>;
  onClick?: (event: MouseEvent) => void;
}

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (props.class) element.className = props.class;
  for (const [name, value] of Object.entries(props.attrs ?? {}))
    element.setAttribute(name, value);
  const onClick = props.onClick;
  if (onClick) element.addEventListener("click", (event) => onClick(event as MouseEvent));
  append(element, children);
  return element;
};

export const append = (parent: Node, children: Child[]): void => {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
};

/** Replaces everything inside `parent`. */
export const replace = (parent: Element, ...children: Child[]): void => {
  parent.replaceChildren();
  append(parent, children);
};

const SVG_NS = "http://www.w3.org/2000/svg";

export const svg = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] => {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  return element;
};
