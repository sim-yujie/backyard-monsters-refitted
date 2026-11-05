const NS = "http://www.w3.org/2000/svg";

let gradients = 0;

/**
 * A shaded padlock: a gold body with a highlight and a keyhole, a steel
 * shackle, dark outlines, in the resource piles' cartoon manner. The HUD's
 * Shiny counter shows it while Shiny Lock is on (bug report #10).
 *
 * STAND-IN: the game has no painted padlock yet. When one is painted
 * (`tools/game-icons`, as `lock`), this function is the one place to swap it
 * for `gameIcon("lock")`.
 */
export const lockArt = (size: number, className = "lock-art"): SVGSVGElement => {
  gradients += 1;
  const gold = `lock-art-gold-${gradients}`;
  const steel = `lock-art-steel-${gradients}`;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", className);

  const defs = document.createElementNS(NS, "defs");
  const gradient = (id: string, stops: readonly [string, string][]): SVGLinearGradientElement => {
    const node = document.createElementNS(NS, "linearGradient");
    node.setAttribute("id", id);
    node.setAttribute("x1", "0");
    node.setAttribute("y1", "0");
    node.setAttribute("x2", "0");
    node.setAttribute("y2", "1");
    for (const [offset, colour] of stops) {
      const stop = document.createElementNS(NS, "stop");
      stop.setAttribute("offset", offset);
      stop.setAttribute("stop-color", colour);
      node.append(stop);
    }
    return node;
  };
  defs.append(
    gradient(gold, [["0", "#ffe98f"], ["0.45", "#f2b62d"], ["1", "#a8640c"]]),
    gradient(steel, [["0", "#f1f4f7"], ["1", "#7d8792"]]),
  );

  const shape = (tag: string, attributes: Record<string, string>): SVGElement => {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  };
  svg.append(
    defs,
    // The shackle: a dark outline under a steel band.
    shape("path", { d: "M7.5 11.5V8a4.5 4.5 0 0 1 9 0v3.5", fill: "none", stroke: "#3b2a14", "stroke-width": "4.2", "stroke-linecap": "round" }),
    shape("path", { d: "M7.5 11.5V8a4.5 4.5 0 0 1 9 0v3.5", fill: "none", stroke: `url(#${steel})`, "stroke-width": "2.4", "stroke-linecap": "round" }),
    // The body, its shine and its keyhole.
    shape("rect", { x: "4", y: "10.5", width: "16", height: "11.5", rx: "2.6", fill: `url(#${gold})`, stroke: "#4a2c06", "stroke-width": "1.4" }),
    shape("rect", { x: "6", y: "11.9", width: "12", height: "1.7", rx: "0.85", fill: "#fff8d6", opacity: "0.7" }),
    shape("path", { d: "M12 14.2a1.7 1.7 0 0 0-.8 3.2l-.5 2.4h2.6l-.5-2.4a1.7 1.7 0 0 0-.8-3.2z", fill: "#4a2c06" }),
  );
  return svg;
};
