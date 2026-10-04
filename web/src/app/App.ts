import { Application, Container } from "pixi.js";
import { createOverlay, type Overlay } from "@/ui/overlay";
import { PerfOverlay } from "@/ui/PerfOverlay";
import { SceneManager, type SceneFactory } from "./SceneManager";
import { withPresence } from "./presenceScene";
import { withIdle } from "./idleScene";
import { IdleWatch, idleDurationText, idleTimingsFor } from "@/game/presence/idleWatch";
import { IdleWarning } from "@/ui/IdleWarning";
import { BootScene } from "./scenes/BootScene";
import { LoginScene } from "./scenes/LoginScene";
import { MapGateScene } from "./scenes/MapGateScene";
import { MapRoom1Scene } from "./scenes/MapRoom1Scene";
import { MapRoom2Scene } from "./scenes/MapRoom2Scene";
import { YardScene } from "./scenes/YardScene";
import { AttackScene } from "./scenes/AttackScene";
import { AwayScene } from "./scenes/AwayScene";
import { BAITER_PLUGINS } from "@/game/baiter/baiterPlugin";
import { WATCH_PLUGINS } from "@/game/autoAttack/watchPlugin";

/** Scene names, so nothing depends on a bare string in two places. */
export const SceneName = {
  BOOT: "boot",
  LOGIN: "login",
  /**
   * "The map", before anything knows which: loads the own yard and opens
   * Map Room 1, Map Room 2 or, with no Map Room, the yard (issue #162).
   */
  MAP: "map",
  /** The neighbours and wild monster tribes, below Map Room 2 (issue #132). */
  MAP_ROOM_1: "maproom1",
  MAP_ROOM_2: "maproom2",
  YARD: "yard",
  /** An attack on a foreign yard; opened through `game/attack/attackTarget`. */
  ATTACK: "attack",
  /**
   * A Wild Monster Baiter practice attack on the own yard (#126): the attack
   * scene with only the battle layer and the Baiter's package, opened through
   * `game/baiter/baiterSession`. Nothing on it talks to the server.
   */
  BAITER: "baiter",
  /**
   * An auto-attack's battle played back (issue #221): the attack scene with
   * only the battle layer and the watch package, opened through
   * `game/autoAttack/watchRun`. Nothing on it talks to the server.
   */
  WATCH: "watch",
  /** "You were away too long": the idle disconnect (#271, `game/presence/idleWatch.ts`). */
  AWAY: "away",
} as const;
export type SceneName = (typeof SceneName)[keyof typeof SceneName];

/**
 * The application shell.
 *
 * Owns the Pixi renderer, the HTML overlay above it and the scene manager that
 * decides what is on screen. Nothing game-specific lives here: scenes do the
 * work, App only keeps the canvas the right size and the clock running.
 */
export class App {
  readonly pixi: Application;
  readonly stage: Container;

  private overlay: Overlay | null = null;
  private perf: PerfOverlay | null = null;
  private scenes: SceneManager | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private idle: IdleWatch | null = null;
  private idleWarning: IdleWarning | null = null;

  constructor(private readonly host: HTMLElement) {
    this.pixi = new Application();
    this.stage = new Container();
  }

  async start(): Promise<void> {
    await this.pixi.init({
      // The canvas fills the window; CSS pins it and `resizeTo` keeps the
      // backing store in step.
      resizeTo: window,
      antialias: true,
      background: "#11141a",
      // Render at the display's true pixel density, capped so a 3x phone does
      // not ask the GPU for nine times the work for no visible gain.
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: "webgl",
    });

    const canvas = this.pixi.canvas;
    this.host.append(canvas);
    this.pixi.stage.addChild(this.stage);

    this.overlay = createOverlay(this.host);
    // Backtick toggles a frame-time readout; costs nothing while hidden.
    this.perf = new PerfOverlay(this.pixi, this.host);

    this.scenes = new SceneManager(
      this.stage,
      this.pixi.renderer,
      this.overlay,
      canvas,
      this.pixi.screen.width,
      this.pixi.screen.height,
    );

    // Ten minutes without input disconnects (#271). The 10 and the 1 minute
    // are `IDLE_TIMINGS`; a dev build takes `?idle=40,20` (seconds) to test.
    const scenes = this.scenes;
    const warning = new IdleWarning(this.host);
    const idle = new IdleWatch({
      timings: idleTimingsFor(window.location.search, import.meta.env.DEV),
      onWarn: (disconnectAt) => warning.show(disconnectAt),
      onCancelWarn: () => warning.hide(),
      onDisconnect: () => scenes.goTo(SceneName.AWAY),
    });
    this.idle = idle;
    this.idleWarning = warning;
    if (import.meta.env.DEV) (globalThis as Record<string, unknown>)["__idle"] = idle;

    // Every screen past sign-in keeps the player online (#242, `presenceScene.ts`)
    // and is watched for the idle disconnect, which an attack or a replay
    // (the Baiter's practice and a Watch included) holds off until it is left.
    const game = (factory: SceneFactory, defer = false): SceneFactory =>
      withPresence(withIdle(factory, idle, { defer }));
    this.scenes
      .register(SceneName.BOOT, () => new BootScene())
      .register(SceneName.LOGIN, () => new LoginScene())
      .register(SceneName.MAP, game(() => new MapGateScene()))
      .register(SceneName.MAP_ROOM_1, game(() => new MapRoom1Scene()))
      .register(SceneName.MAP_ROOM_2, game(() => new MapRoom2Scene()))
      .register(SceneName.YARD, game(() => new YardScene()))
      .register(SceneName.ATTACK, game(() => new AttackScene(), true))
      .register(SceneName.BAITER, game(() => new AttackScene(BAITER_PLUGINS, { practice: true }), true))
      .register(SceneName.WATCH, game(() => new AttackScene(WATCH_PLUGINS, { watch: true }), true))
      .register(
        SceneName.AWAY,
        () => new AwayScene(idleDurationText(idle.timings.disconnectMs), this.halt),
      );

    // Pixi's renderer resize fires on the window; mirror it to the scenes.
    this.pixi.renderer.on("resize", this.handleResize);
    // resizeTo: window misses the case where the host element itself changes,
    // which happens with a sidebar or a devtools dock.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.pixi.resize());
      this.resizeObserver.observe(this.host);
    }

    this.pixi.ticker.add((ticker) => {
      this.scenes?.tick(ticker.deltaMS / 1000);
    });

    await this.scenes.start(SceneName.BOOT);
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.idle?.destroy();
    this.idle = null;
    if (import.meta.env.DEV) delete (globalThis as Record<string, unknown>)["__idle"];
    this.idleWarning?.hide();
    this.idleWarning = null;
    this.pixi.renderer.off("resize", this.handleResize);
    this.scenes?.destroy();
    this.scenes = null;
    this.perf?.destroy();
    this.perf = null;
    this.overlay?.destroy();
    this.overlay = null;
    this.pixi.destroy(true, { children: true });
  }

  /** Stops the frame clock behind the disconnect screen (#271); the overlay is DOM and stays. */
  private readonly halt = (): void => {
    this.pixi.render();
    this.pixi.ticker.stop();
  };

  private readonly handleResize = (width: number, height: number): void => {
    this.scenes?.resize(width, height);
  };
}
