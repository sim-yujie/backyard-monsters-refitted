import { Graphics } from "pixi.js";
import { guideApi, type GuideApi } from "@/api/guide";
import { ATTACK_PLUGINS, type AttackMounts, type AttackPlugin } from "@/game/attack/attackPlugins";
import { ATTACK_DROP_FILTERS, type DropTool } from "@/game/attack/AttackInput";
import { bucketFor } from "@/game/attack/bucket";
import { guideBus } from "@/game/guide/guideBus";
import {
  inPracticeBox,
  PRACTICE_CAMP_BASEID,
  practiceBoxCorners,
} from "@/game/guide/practiceBox";
import { dotsFor, LINES } from "@/game/guide/steps";
import { registerCanvasTarget, TutTarget, type TargetRect } from "@/game/guide/targets";
import type { Point } from "@/game/yard/YardGrid";
import { armyPanelFor } from "@/ui/attack/ArmyPanel";
import { GuideOverlay, type GuideStep } from "@/ui/guide/GuideOverlay";
import "@/ui/styles/guide-start.css";

/**
 * Attack-scene plugin for the guided start's practice attack (issue #227,
 * `docs/design/tutorial.md` §2.3 step 15, §5.4). Mounts only on the practice
 * camp, Map Room 1 tribe base `"1"`, which exists only while the player's
 * guide is at the attack.
 *
 * Idiot-proofing, as the owner decided (decision 4): the army panel is locked
 * but for Fill all, so every Pokey goes; then Fill all locks too. The only
 * legal drop is inside a glowing box east of the tower (`practiceBox.ts`),
 * where 15 level 1 Pokeys always win (`practiceCamp.test.ts`). Speed and
 * Retreat stay; a retreat or a loss leads to the free retry on the map.
 * Bob talks through it on the attack's guide layer.
 *
 * The plugin decides nothing the server checks: the attack load and save are
 * the ordinary Map Room 1 tribe ones, and the server replays the battle.
 */

/** Seconds between Bob's battle lines. */
const BATTLE_LINE_SECONDS = 6;
/** The box's colour: Bob's green, as the camp's glow on the map. */
const BOX_COLOUR = 0xb6f36a;

/** Whether this attack is the practice attack. */
export const isPracticeAttack = (mounts: Pick<AttackMounts, "target" | "practice" | "watch">): boolean =>
  mounts.target.baseid === PRACTICE_CAMP_BASEID &&
  (mounts.target.mapversion ?? 2) === 1 &&
  !mounts.practice &&
  !mounts.watch;

/** The refusal a fling outside the box gets; null for anything else. */
export const practiceDropFilter = (point: Point, tool: DropTool): string | null =>
  tool.kind === "fling" && !inPracticeBox(point) ? LINES.outsideBox : null;

/** The plugin, with the guide's routes injectable for the tests. */
export const practicePlugin =
  (api: GuideApi = guideApi): AttackPlugin =>
  (mounts) => {
    if (!isPracticeAttack(mounts)) return;
    const { session, renderer, camera, canvas } = mounts;
    const bucket = bucketFor(session);
    const overlay = new GuideOverlay(mounts.guide);
    const off: (() => void)[] = [];

    // The map's Attack is the step's end (pick-camp to attack); refused when already there.
    api.advance("pick-camp").catch(() => {});

    /* ── The army panel ───────────────────────────────────────────── */

    const panel = (): ReturnType<typeof armyPanelFor> => armyPanelFor(bucket);
    const lockArmy = (): void => {
      const full = !bucket.ids().some((id) => bucket.max(id) > bucket.requestedCount(id));
      panel()?.lock({ steppers: true, clear: true, fillAll: full && !bucket.isEmpty() });
    };
    lockArmy();
    off.push(bucket.subscribe(() => lockArmy()));

    /* ── The drop box ─────────────────────────────────────────────── */

    ATTACK_DROP_FILTERS.push(practiceDropFilter);
    off.push(() => {
      const at = ATTACK_DROP_FILTERS.indexOf(practiceDropFilter);
      if (at >= 0) ATTACK_DROP_FILTERS.splice(at, 1);
    });

    const box = new Graphics();
    box.eventMode = "none";
    mounts.battleLayer.addChild(box);
    const corners = practiceBoxCorners().map((corner) => renderer.yardToWorld(corner.x, corner.y));
    const drawBox = (alpha: number): void => {
      box.clear();
      box.poly(corners.flatMap((corner) => [corner.x, corner.y]), true);
      box.fill({ color: BOX_COLOUR, alpha: 0.18 + alpha * 0.14 });
      box.poly(corners.flatMap((corner) => [corner.x, corner.y]), true);
      box.stroke({ width: 4, color: BOX_COLOUR, alpha: 0.65 + alpha * 0.35 });
    };
    let pulse: number | null = null;
    const animate = (time: number): void => {
      drawBox((Math.sin(time / 300) + 1) / 2);
      pulse = requestAnimationFrame(animate);
    };
    pulse = requestAnimationFrame(animate);
    off.push(() => {
      if (pulse !== null) cancelAnimationFrame(pulse);
      box.parent?.removeChild(box);
      box.destroy();
    });

    /** The box on screen, for Bob's hand and the spotlight's hole. */
    const boxRect = (): TargetRect | null => {
      if (!box.visible) return null;
      const bounds = canvas.getBoundingClientRect();
      const points = corners.map((corner) => camera.worldToScreen(corner));
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const left = Math.min(...xs) + bounds.left;
      const top = Math.min(...ys) + bounds.top;
      return { left, top, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    };
    off.push(registerCanvasTarget(TutTarget.PRACTICE_BOX, () => boxRect()));

    /* ── Bob ──────────────────────────────────────────────────────── */

    let shownKey: string | null = null;
    let ended: { destroyed: boolean } | null = null;
    let asking = false;
    const line = (text: string, extra: Partial<GuideStep> = {}): GuideStep => ({
      text,
      dots: dotsFor("attack"),
      skip: { label: "Skip", onClick: () => askSkip() },
      ...extra,
    });
    const show = (key: string, step: GuideStep | null): void => {
      if (key === shownKey || asking) return;
      shownKey = key;
      if (step) overlay.show(step);
      else overlay.hide();
    };

    const render = (): void => {
      const state = session.state();
      if (ended) {
        box.visible = false;
        show(
          `end:${ended.destroyed}`,
          line(ended.destroyed ? LINES.won : LINES.lostHere, {
            mood: ended.destroyed ? "happy" : "worried",
            target: TutTarget.ATTACK_HOME,
          }),
        );
        return;
      }
      if (state.acted) {
        box.visible = false;
        const index = Math.floor(state.elapsedSeconds / BATTLE_LINE_SECONDS) % LINES.battle.length;
        show(`battle:${index}`, line(LINES.battle[index]!, { block: false }));
        return;
      }
      if (bucket.isEmpty()) {
        show("fill", line(`${LINES.attackBase} ${LINES.fillAll}`, { target: TutTarget.FILL_ALL }));
        return;
      }
      show("drop", line(LINES.dropBox, { target: TutTarget.PRACTICE_BOX }));
    };

    const askSkip = (): void => {
      asking = true;
      shownKey = "skip-ask";
      overlay.show({
        text: LINES.skipAsk,
        mood: "worried",
        actions: [
          {
            label: "Keep going",
            onClick: () => {
              asking = false;
              shownKey = null;
              render();
            },
          },
          {
            label: "Skip",
            primary: true,
            onClick: () => {
              asking = false;
              api.skip().catch(() => {});
              teardown();
            },
          },
        ],
      });
    };

    off.push(session.subscribe(() => render()));
    off.push(bucket.subscribe(() => render()));
    off.push(
      guideBus.on("attackEnded", ({ baseid, destroyed }) => {
        if (baseid !== PRACTICE_CAMP_BASEID) return;
        ended = { destroyed };
        render();
      }),
    );
    render();

    let done = false;
    const teardown = (): void => {
      if (done) return;
      done = true;
      for (const one of off.reverse()) one();
      panel()?.lock(null);
      overlay.destroy();
    };
    return teardown;
  };

ATTACK_PLUGINS.push(practicePlugin());
