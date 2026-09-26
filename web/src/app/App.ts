import { Application, Container } from "pixi.js";
import { createOverlay, type Overlay } from "@/ui/overlay";
import { PerfOverlay } from "@/ui/PerfOverlay";
import { SceneManager } from "./SceneManager";
import { BootScene } from "./scenes/BootScene";
import { LoginScene } from "./scenes/LoginScene";
import { MapRoom2Scene } from "./scenes/MapRoom2Scene";
import { YardScene } from "./scenes/YardScene";
import { AttackScene } from "./scenes/AttackScene";

/** Scene names, so nothing depends on a bare string in two places. */
export const SceneName = {
  BOOT: "boot",
  LOGIN: "login",
  MAP_ROOM_2: "maproom2",
  YARD: "yard",
  /** An attack on a foreign yard; opened through `game/attack/attackTarget`. */
  ATTACK: "attack",
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

    this.scenes
      .register(SceneName.BOOT, () => new BootScene())
      .register(SceneName.LOGIN, () => new LoginScene())
      .register(SceneName.MAP_ROOM_2, () => new MapRoom2Scene())
      .register(SceneName.YARD, () => new YardScene())
      .register(SceneName.ATTACK, () => new AttackScene());

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
    this.pixi.renderer.off("resize", this.handleResize);
    this.scenes?.destroy();
    this.scenes = null;
    this.perf?.destroy();
    this.perf = null;
    this.overlay?.destroy();
    this.overlay = null;
    this.pixi.destroy(true, { children: true });
  }

  private readonly handleResize = (width: number, height: number): void => {
    this.scenes?.resize(width, height);
  };
}
