import { classicLook } from "@/game/classicLook";
import {
  currentGround,
  GROUNDS,
  groundsFor,
  groundSwatchUrl,
  pickGround,
  saveGround,
  savedGround,
  type GroundId,
} from "@/game/yard/groundChoice";
import "@/ui/styles/ground-picker.css";

/** The words of the Yard ground row, kept short (owner: pictures over words). */
export const GROUND_TEXT = {
  label: "Yard ground",
  hint: "The ground under every yard you see.",
  laterHint: "Shows with this Style, after the reload.",
  failed: "Could not save this in your browser. Check that site data is allowed.",
} as const;

/**
 * Settings, Look and sound: the yard ground (owner, 12 Nov 2026), a row of
 * picture swatches with the chosen one framed in the accent colour
 * (`game/yard/groundChoice.ts`). `classic` is the Style the swatches are for:
 * the one the dialog shows, which can differ from the page's own until the
 * reload. A pick for the page's own Style changes the yard at once; a pick for
 * the other is saved for the reload.
 */
export const groundPicker = (classic: boolean): HTMLElement => {
  const wrap = document.createElement("div");
  wrap.className = "ground-picker";

  const label = document.createElement("span");
  label.className = "ground-picker__label";
  label.id = "settings-ground-label";
  label.textContent = GROUND_TEXT.label;

  const row = document.createElement("div");
  row.className = "ground-picker__row";
  row.setAttribute("role", "radiogroup");
  row.setAttribute("aria-labelledby", label.id);

  const hint = document.createElement("p");
  hint.className = "field__hint";
  hint.id = "settings-ground-hint";
  hint.setAttribute("aria-live", "polite");
  const live = classic === classicLook();
  hint.textContent = live ? GROUND_TEXT.hint : GROUND_TEXT.laterHint;
  row.setAttribute("aria-describedby", hint.id);

  const swatches = new Map<GroundId, HTMLButtonElement>();
  const show = (chosen: GroundId): void => {
    for (const [id, swatch] of swatches) {
      const on = id === chosen;
      swatch.setAttribute("aria-checked", String(on));
      swatch.tabIndex = on ? 0 : -1;
    }
  };

  const choose = (id: GroundId): void => {
    const saved = live ? pickGround(id) : saveGround(classic, id);
    show(id);
    hint.textContent = saved ? (live ? GROUND_TEXT.hint : GROUND_TEXT.laterHint) : GROUND_TEXT.failed;
    hint.classList.toggle("field__hint--error", !saved);
  };

  const ids = groundsFor(classic);
  for (const id of ids) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "ground-picker__swatch";
    swatch.dataset["ground"] = id;
    swatch.setAttribute("role", "radio");
    swatch.title = GROUNDS[id].name;
    const picture = document.createElement("img");
    picture.className = "ground-picker__picture";
    picture.src = groundSwatchUrl(id);
    picture.width = 72;
    picture.height = 48;
    picture.alt = "";
    picture.decoding = "async";
    picture.draggable = false;
    const name = document.createElement("span");
    name.className = "ground-picker__name";
    name.textContent = GROUNDS[id].name;
    swatch.append(picture, name);
    swatch.addEventListener("click", () => choose(id));
    swatch.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = ids[(ids.indexOf(id) + step + ids.length) % ids.length];
      if (!next) return;
      choose(next);
      swatches.get(next)?.focus();
    });
    swatches.set(id, swatch);
    row.append(swatch);
  }
  show(live ? currentGround() : savedGround(classic));

  wrap.append(label, row, hint);
  return wrap;
};
