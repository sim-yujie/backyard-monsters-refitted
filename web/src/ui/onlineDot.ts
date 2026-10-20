/**
 * The green "online" dot beside a player's name (Map Room 1, the Friends
 * list), as most games show it: the dot alone says the player is online, and
 * an offline player gets no dot and no "Offline" word. `ui.css` styles it.
 *
 * It reads "Online" to a screen reader and on hover. `decorative` is for a
 * dot whose words beside it already say so (the target card's "Online now."),
 * which a screen reader then skips.
 */
export const onlineDot = (className = "", decorative = false): HTMLSpanElement => {
  const dot = document.createElement("span");
  dot.className = `online-dot ${className}`.trim();
  dot.title = "Online";
  if (decorative) {
    dot.setAttribute("aria-hidden", "true");
  } else {
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", "Online");
  }
  return dot;
};
