import { loadInfernoState, loadInfernoYard, type MolochGroup } from "@/api/inferno";
import { transferActions } from "@/api/infernoTransfer";
import { raidApi } from "@/api/raid";
import { prefersReducedMotion } from "@/game/attack/AttackBattleLayer";
import { screenShakeOn } from "@/game/attack/juice";
import {
  CAVE_MAX_LEVEL,
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
import { enterDescent } from "@/game/inferno/descentEntry";
import { isMolochRaid, startMolochRaid } from "@/game/inferno/molochRaid";
import { academyLevel, housingSummary } from "@/game/monsters/housing";
import { housingSpace } from "@/game/monsters/monsterCatalogue";
import { consumeRaidResult, setRaidRun } from "@/game/raid/raidSession";
import { raidWatch } from "@/game/raid/raidWatch";
import {
  caveMenu,
  caveNote,
  earthquakeBanner,
  emergenceComplete,
  molochDialogue,
  molochWarning,
  stagePassed,
} from "@/ui/inferno/EmergenceScreens";
import { AscendDialog } from "@/ui/inferno/AscendDialog";
import { INFERNO_YARD, MAIN_YARD } from "../ownYards";
import { YardView } from "../YardRenderer";
import { YARD_PLUGINS, type YardMounts, type YardPlugin } from "../yardPlugins";

/**
 * Own-yard plugin for Moloch's cave (WP 1.10, `docs/design/inferno.md` §2.2):
 * on the main yard, while the load says the cave shows (`infernostate`, sent
 * only with the new Inferno switched on), it draws the cave outside the plot,
 * answers a tap on it, and, when this load raised it (`raised`), plays the
 * emergence: the camera turns to it, Moloch speaks, the earthquake, and his
 * warning, whose "Engage Attack" starts his raid (WP 1.9) in the raid scene.
 * Back from that fight, it plays "stage passed" and his taunt in place of the
 * wild raid's result. Bob's tips and the achievement card keep out of its way
 * while it plays (`emergenceHold.ts`).
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

/**
 * The cave drawn outside the plot at a level, following the yard as it is
 * drawn afresh, and a tap on it (a press that is not a drag, in the iso
 * view, with nothing in hand) handed to `onTap`. Returns the sprite and the
 * way to take both down.
 */
const mountCave = (
  mounts: YardMounts,
  level: number,
  onTap: () => void,
): { readonly cave: CaveSprite; readonly dispose: () => void } => {
  const { renderer, camera, canvas, scene } = mounts;
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
    if (cave.contains(world.x, world.y)) onTap();
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);

  return {
    cave,
    dispose: () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      renderer.leaveBuildings(cave.view);
      cave.destroy();
    },
  };
};

/**
 * The cave in the Inferno yard (WP 1.18): Flash puts the portal there at its
 * top level, at the same spot as on the surface (`INFERNO_EMERGENCE_EVENT.as:66-68`,
 * `INFERNOPORTAL.AddPortal(5)`), and its one button, Exit Cavern, loads the
 * main yard again (`BUILDINGINFO.as:298-300`, `INFERNOPORTAL.ToggleYard`).
 */
const infernoYardCave = (mounts: YardMounts): (() => void) => {
  const { overlay, scene } = mounts;
  const { dispose } = mountCave(mounts, CAVE_MAX_LEVEL, () => {
    if (popupOpen()) return;
    caveMenu(overlay.modal, { exit: () => scene.openYard(MAIN_YARD) });
  });
  return dispose;
};

export const infernoYardPlugin: YardPlugin = (mounts) => {
  const { store, overlay, renderer, notices, scene } = mounts;
  if (store.kind === "inferno") return infernoYardCave(mounts);
  if (store.kind !== "main") return;
  const state = caveState(store.save);
  if (!state) return;

  let alive = true;
  let level = state.cave.level;
  // Whether the Descent is won and the Inferno yard is there to go down to.
  let hasYard = state.hasYard;
  let raidRunning = false;
  const notice = (message: string): void => notices.show("inferno", message, { level: "info", timeoutMs: 6_000 });
  const townHall = (): number => store.yard.townHall?.level ?? 0;

  // A tap is answered after the state is read afresh (`openTap`, below).
  let openTap: () => Promise<void> = async () => {};
  const { cave, dispose: disposeCave } = mountCave(mounts, level, () => void openTap());

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
  // Enter Cavern: down to the Inferno yard once the Descent is won
  // (`INFERNOPORTAL.EnterPortal`, `MAPROOM_DESCENT.DescentPassed`), else
  // the Descent map, whose Attack opens the attack scene (WP 1.13).
  const enter = (): void => {
    if (hasYard) {
      scene.openYard(INFERNO_YARD);
      return;
    }
    void enterDescent({
      modal: overlay.modal,
      own: () => ({ save: store.save, yard: store.yard }),
      notice,
      openInferno: () => scene.openYard(INFERNO_YARD),
      openAttack: (target) => scene.openAttack(target),
    });
  };
  // Transfer Monsters: Inferno monsters up from the Compound into this
  // yard's Housing (WP 2.6, `INFERNOPORTAL.AscendMonsters`).
  const transfer = (): void => {
    const actions = transferActions(store);
    new AscendDialog({
      load: async () => (await loadInfernoYard()).monsters?.housed ?? {},
      room: () => {
        const { used, total } = housingSummary(store.save, store.now());
        return { used, capacity: total };
      },
      sizeOf: (id) => housingSpace(id, academyLevel(store.save.academy, id)) ?? 0,
      send: async (picked) => {
        const result = await actions.transfer(picked);
        return result.ok ? null : result.refusal.message;
      },
      onDone: notice,
    }).mount(overlay.modal);
  };
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
    warning: (groups, engage) => closing((done) => molochWarning(overlay.modal, groups, engage, done)),
    stagePassed: () => closing((done) => stagePassed(overlay.modal, done)),
    complete: () =>
      closing((done) => emergenceComplete(overlay.modal, townHall() >= CAVE_TOWN_HALL ? enter : null, done)),
  };

  /* ── A tap on the cave ── */
  openTap = async (): Promise<void> => {
    // The latest word on the cave: the yard may have been open for hours.
    try {
      const fresh = await loadInfernoState();
      if (!alive) return;
      if (fresh.cave.level > level) view.setCaveLevel(fresh.cave.level);
      hasYard = fresh.hasYard ?? hasYard;
    } catch {
      // The load's word stands.
    }
    if (!alive) return;
    const tap = caveTap(level, townHall(), raidRunning);
    if (tap.kind === "menu") {
      caveMenu(overlay.modal, hasYard ? { enter, transfer } : { enter });
    } else if (tap.kind === "note") {
      const hall = store.yard.townHall;
      caveNote(overlay.modal, tap.text, tap.upgrade && hall ? () => scene.focusBuilding(hall.id) : null);
    }
  };

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
  // "Engage Attack": the server fights Moloch's raid and the raid scene plays it.
  const molochRaid = (id: string, groups: readonly MolochGroup[]) => ({
    groups,
    start: () =>
      startMolochRaid(id, {
        api: raidApi,
        notice,
        fight: (start) => {
          raidWatch.set(start.raid);
          setRaidRun({ raid: start.raid, fight: start.fight, save: store.save });
          scene.openRaid();
        },
      }),
  });
  const raiseKey = state.raised !== null ? `${state.raised}:${state.emergence.lastAt ?? 0}` : null;
  if (state.raised !== null && raiseKey !== playedRaise) {
    playedRaise = raiseKey;
    raidRunning = true;
    const raised = state.raised;
    const raid = state.raid ? molochRaid(state.raid.id, state.raid.groups) : null;
    void staged(() => playEmergence(raised, { view, wait, alive: () => alive, raid })).finally(() => {
      raidRunning = false;
    });
  }

  // Back from Moloch's raid, won or lost: "stage passed" and his taunt.
  if (consumeRaidResult(isMolochRaid)) void staged(() => playStagePassed(state.cave.level, view));

  if (import.meta.env.DEV) {
    // Moloch's popups without his raids, for the screenshots: the warning's
    // "Engage Attack" only closes it.
    const army: MolochGroup[] = [
      { monster: "IC1", count: 12 },
      { monster: "IC2", count: 6 },
      { monster: "IC3", count: 4 },
    ];
    const preview = { groups: army, start: async () => true };
    (globalThis as Record<string, unknown>)["__infernoPreview"] = {
      raise: (to: number) => staged(() => playEmergence(to, { view, wait, alive: () => alive, raid: preview })),
      warning: (groups: MolochGroup[] = army) => staged(() => view.warning(groups, preview.start)),
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
    disposeCave();
    if (import.meta.env.DEV) delete (globalThis as Record<string, unknown>)["__infernoPreview"];
  };
};

YARD_PLUGINS.push(infernoYardPlugin);
