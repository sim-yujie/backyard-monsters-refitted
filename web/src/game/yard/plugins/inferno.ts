import { loadInfernoState } from "@/api/inferno";
import { prefersReducedMotion } from "@/game/attack/AttackBattleLayer";
import { screenShakeOn } from "@/game/attack/juice";
import {
  CAVE_TOWN_HALL,
  SHAKE_FPS,
  SHAKE_FRAMES,
  caveCentre,
  caveState,
  caveTap,
  shakeOffset,
} from "@/game/inferno/cave";
import { CaveSprite } from "@/game/inferno/CaveSprite";
import { playEmergence, playStagePassed, type EmergenceView } from "@/game/inferno/emergenceFlow";
import { holdForEmergence } from "@/game/inferno/emergenceHold";
import { DESCENT_NOT_YET, TRANSFER_NOT_YET } from "@/game/inferno/emergenceText";
import {
  caveMenu,
  caveNote,
  earthquakeBanner,
  emergenceComplete,
  molochDialogue,
  stagePassed,
} from "@/ui/inferno/EmergenceScreens";
import { YardView } from "../YardRenderer";
import { YARD_PLUGINS, type YardPlugin } from "../yardPlugins";

/**
 * Own-yard plugin for Moloch's cave (WP 1.10, `docs/design/inferno.md` §2.2):
 * on the main yard, while the load says the cave shows (`infernostate`, sent
 * only with the new Inferno switched on), it draws the cave outside the plot,
 * answers a tap on it, and, when this load raised it (`raised`), plays the
 * emergence: the camera turns to it, Moloch speaks, the earthquake. Bob's
 * tips and the achievement card keep out of its way while it plays
 * (`emergenceHold.ts`).
 */

/** Pointer travel, CSS px, above which a press is a drag (`YardInput`'s `DRAG_SLOP`). */
const DRAG_SLOP = 6;

/**
 * The raise last played, so a yard opened again on the same answer (a store
 * kept across a scene) does not play it twice. Keyed by level and time.
 */
let playedRaise: string | null = null;

/** Forgets {@link playedRaise}, for tests. */
export const resetInfernoPlugin = (): void => {
  playedRaise = null;
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether a popup is open anywhere on the page. */
const popupOpen = (): boolean => document.querySelector(".popup-backdrop") !== null;

export const infernoYardPlugin: YardPlugin = (mounts) => {
  const { store, overlay, renderer, camera, canvas, notices, scene } = mounts;
  if (store.kind !== "main") return;
  const state = caveState(store.save);
  if (!state) return;

  let alive = true;
  let level = state.cave.level;
  let raidRunning = false;
  const notice = (message: string): void => notices.show("inferno", message, { level: "info", timeoutMs: 6_000 });
  const townHall = (): number => store.yard.townHall?.level ?? 0;

  const cave = new CaveSprite();
  const shown = renderer.shown;
  if (shown) cave.place(shown.bounds);
  // The yard is drawn afresh on every change; the cave follows its world. It
  // stands in the buildings' layer, which the blueprint view hides.
  cave.view.onRender = () => {
    const yard = renderer.shown;
    if (yard) cave.place(yard.bounds);
  };
  cave.setLevel(level);
  renderer.standAmongBuildings(cave.view);

  /* ── The earthquake's shake ── */
  let shakeFrame = 0;
  const stopShake = (): void => {
    if (shakeFrame) cancelAnimationFrame(shakeFrame);
    shakeFrame = 0;
    renderer.root.pivot.set(0, 0);
  };
  const shake = (): void => {
    if (!screenShakeOn() || prefersReducedMotion()) return;
    stopShake();
    const started = performance.now();
    const step = (now: number): void => {
      const framesLeft = SHAKE_FRAMES - Math.floor(((now - started) / 1000) * SHAKE_FPS);
      if (!alive || framesLeft <= 0) {
        stopShake();
        return;
      }
      const offset = shakeOffset(framesLeft, Math.random);
      const zoom = renderer.zoom > 0 ? renderer.zoom : 1;
      renderer.root.pivot.set(offset.x / zoom, offset.y / zoom);
      shakeFrame = requestAnimationFrame(step);
    };
    shakeFrame = requestAnimationFrame(step);
  };

  /* ── Moloch's popups, each a promise of its closing ── */
  const closing = (open: (done: () => void) => void): Promise<void> =>
    new Promise((resolve) => open(resolve));
  const enter = (): void => notice(DESCENT_NOT_YET);
  const view: EmergenceView = {
    setCaveLevel: (next) => {
      level = Math.max(next, 0);
      cave.setLevel(level);
    },
    focusCave: () => {
      const centre = caveCentre();
      scene.closePanel();
      scene.centreOn(centre.x, centre.y);
    },
    busy: () => popupOpen() || scene.plannerOpen() || scene.carrying() || scene.selectedBuilding() !== null,
    moloch: (text) => closing((done) => molochDialogue(overlay.modal, text, done)),
    earthquake: () => {
      const banner = earthquakeBanner(overlay.content);
      shake();
      return () => banner.remove();
    },
    stagePassed: () => closing((done) => stagePassed(overlay.modal, done)),
    complete: () =>
      closing((done) => emergenceComplete(overlay.modal, townHall() >= CAVE_TOWN_HALL ? enter : null, done)),
  };

  /* ── A tap on the cave ── */
  const openTap = async (): Promise<void> => {
    // The latest word on the cave: the yard may have been open for hours.
    try {
      const fresh = await loadInfernoState();
      if (!alive) return;
      if (fresh.cave.level > level) view.setCaveLevel(fresh.cave.level);
    } catch {
      // The load's word stands.
    }
    if (!alive) return;
    const tap = caveTap(level, townHall(), raidRunning);
    if (tap.kind === "menu") {
      caveMenu(overlay.modal, { enter, transfer: () => notice(TRANSFER_NOT_YET) });
    } else if (tap.kind === "note") {
      const hall = store.yard.townHall;
      caveNote(overlay.modal, tap.text, tap.upgrade && hall ? () => scene.focusBuilding(hall.id) : null);
    }
  };

  let pressX = 0;
  let pressY = 0;
  let pressed = false;
  const onDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pressed = true;
    pressX = event.clientX;
    pressY = event.clientY;
  };
  const onUp = (event: PointerEvent): void => {
    if (!pressed) return;
    pressed = false;
    if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > DRAG_SLOP) return;
    if (scene.plannerOpen() || scene.carrying() || renderer.view !== YardView.ISO) return;
    const rect = canvas.getBoundingClientRect();
    const world = camera.screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    if (cave.contains(world.x, world.y)) void openTap();
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);

  /* ── The emergence this load raised ── */
  // Each run holds the tips and the achievement card back until it ends, or the yard goes.
  const holds = new Set<() => void>();
  const staged = (run: () => Promise<void>): Promise<void> => {
    const release = holdForEmergence();
    holds.add(release);
    return run().finally(() => {
      holds.delete(release);
      release();
    });
  };
  const raiseKey = state.raised !== null ? `${state.raised}:${state.emergence.lastAt ?? 0}` : null;
  if (state.raised !== null && raiseKey !== playedRaise) {
    playedRaise = raiseKey;
    raidRunning = true;
    const raised = state.raised;
    void staged(() => playEmergence(raised, { view, wait, alive: () => alive })).finally(() => {
      // WP 1.9's raid keeps this set while it runs.
      raidRunning = false;
    });
  }

  if (import.meta.env.DEV) {
    // Moloch's popups without his raids, for the screenshots (WP 1.9 plays them for real).
    (globalThis as Record<string, unknown>)["__infernoPreview"] = {
      raise: (to: number) => staged(() => playEmergence(to, { view, wait, alive: () => alive })),
      stagePassed: (at: number) => staged(() => playStagePassed(at, view)),
      tap: () => openTap(),
      focus: () => view.focusCave(),
    };
  }

  return () => {
    alive = false;
    for (const release of holds) release();
    holds.clear();
    stopShake();
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointerup", onUp);
    renderer.leaveBuildings(cave.view);
    cave.destroy();
    if (import.meta.env.DEV) delete (globalThis as Record<string, unknown>)["__infernoPreview"];
  };
};

YARD_PLUGINS.push(infernoYardPlugin);
