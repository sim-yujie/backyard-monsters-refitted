import type { YardRefusal } from "@/api/yard";

/**
 * Small helpers the game's windows share. Each was copied, line for line,
 * into a dozen files before (beta 9 audit, 21 Nov 2026).
 */

/** An element with its class and, when given, its text. */
export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

/** What a yard action's refusal says to the player: the server's own words, or a plain line when it could not be reached. */
export const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network" ? "Could not reach the server. Try again." : refusal.message || "That did not work.";
