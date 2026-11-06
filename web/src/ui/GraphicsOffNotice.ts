/**
 * "Graphics are off" (`app/graphicsOff.ts`): shown instead of a broken screen
 * when the browser will not let the game draw. Plain HTML and CSS only, since
 * the game's own drawing is exactly what is missing; it wears the game's
 * window (`.panel`, painted by the Modern or Classic skin) over the page's
 * dark background. Retry loads the page again, after the player has changed
 * the setting.
 */
export const GRAPHICS_OFF_STEPS: readonly string[] = [
  "Turn on hardware acceleration (“Use graphics acceleration”) in your browser’s settings, then restart the browser.",
  "Make sure WebGL is not blocked by a setting, a privacy add-on or a school or work policy.",
  "Or try another browser, such as Chrome, Edge or Firefox.",
];

export const showGraphicsOffNotice = (
  host: HTMLElement,
  retry: () => void = () => window.location.reload(),
): HTMLElement => {
  host.querySelector(".graphics-off")?.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "popup-backdrop graphics-off";

  const panel = document.createElement("section");
  panel.className = "panel graphics-off__panel";
  panel.setAttribute("role", "alertdialog");
  panel.setAttribute("aria-labelledby", "graphics-off-title");
  panel.setAttribute("aria-describedby", "graphics-off-text");

  const titlebar = document.createElement("header");
  titlebar.className = "panel__titlebar";
  const title = document.createElement("h2");
  title.className = "panel__title";
  title.id = "graphics-off-title";
  title.textContent = "Graphics are off";
  titlebar.append(title);

  const body = document.createElement("div");
  body.className = "panel__body graphics-off__body";

  const text = document.createElement("p");
  text.className = "graphics-off__text";
  text.id = "graphics-off-text";
  text.textContent = "Your browser has graphics turned off, so the game can’t draw.";

  const steps = document.createElement("ol");
  steps.className = "graphics-off__steps";
  for (const step of GRAPHICS_OFF_STEPS) {
    const item = document.createElement("li");
    item.textContent = step;
    steps.append(item);
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--primary graphics-off__retry";
  button.textContent = "Retry";
  button.addEventListener("click", () => retry());

  body.append(text, steps, button);
  panel.append(titlebar, body);
  backdrop.append(panel);
  host.append(backdrop);
  button.focus();
  return backdrop;
};
