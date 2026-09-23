import type { Container, Renderer } from "pixi.js";
import type { Overlay } from "@/ui/overlay";

/** What a scene is handed when it is created. */
export interface SceneContext {
  /** The Pixi container this scene draws into. Emptied when the scene exits. */
  readonly stage: Container;
  /** The live renderer, for a scene that bakes textures of its own. */
  readonly renderer: Renderer;
  /** The HTML overlay layers for this scene's panels and popups. */
  readonly overlay: Overlay;
  /** The element the canvas lives in, for attaching input. */
  readonly canvas: HTMLCanvasElement;
  /** Viewport size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Asks the manager to switch to another scene after the current frame. */
  goTo(scene: string): void;
}

/**
 * One screen of the game.
 *
 * Every hook is optional so a placeholder scene can be a few lines. `update` is
 * given the frame delta in seconds, not Pixi's frame-ratio, because game logic
 * is easier to reason about in real time.
 */
export interface Scene {
  enter?(context: SceneContext): void | Promise<void>;
  exit?(): void;
  update?(deltaSeconds: number): void;
  resize?(width: number, height: number): void;
}

export type SceneFactory = () => Scene;

/**
 * Owns which scene is running and drives its lifecycle.
 *
 * Switching is deferred to the next tick rather than done inline, so a scene
 * can ask for a switch from inside its own `update` or from a DOM handler
 * without being torn down mid-call.
 */
export class SceneManager {
  private readonly factories = new Map<string, SceneFactory>();
  private currentName: string | null = null;
  private current: Scene | null = null;
  private pending: string | null = null;
  private switching = false;

  constructor(
    private readonly stage: Container,
    private readonly renderer: Renderer,
    private readonly overlay: Overlay,
    private readonly canvas: HTMLCanvasElement,
    private width: number,
    private height: number,
  ) {}

  /** Registers a scene under a name. */
  register(name: string, factory: SceneFactory): this {
    this.factories.set(name, factory);
    return this;
  }

  get activeScene(): string | null {
    return this.currentName;
  }

  /** Queues a switch, applied on the next tick. */
  goTo(name: string): void {
    if (!this.factories.has(name)) {
      throw new Error(`No scene registered as "${name}"`);
    }
    this.pending = name;
  }

  /** Switches immediately; used once at startup. */
  async start(name: string): Promise<void> {
    this.pending = name;
    await this.applyPending();
  }

  /** Advances the active scene, after applying any queued switch. */
  tick(deltaSeconds: number): void {
    if (this.pending && !this.switching) void this.applyPending();
    this.current?.update?.(deltaSeconds);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.current?.resize?.(width, height);
  }

  /** Tears down the active scene without starting another. */
  destroy(): void {
    this.exitCurrent();
  }

  private exitCurrent(): void {
    this.current?.exit?.();
    this.current = null;
    this.currentName = null;
    this.stage.removeChildren();
    this.overlay.clear();
  }

  private async applyPending(): Promise<void> {
    const name = this.pending;
    if (!name) return;

    this.switching = true;
    this.pending = null;

    try {
      this.exitCurrent();

      const factory = this.factories.get(name);
      if (!factory) throw new Error(`No scene registered as "${name}"`);

      const scene = factory();
      this.current = scene;
      this.currentName = name;

      await scene.enter?.({
        stage: this.stage,
        renderer: this.renderer,
        overlay: this.overlay,
        canvas: this.canvas,
        width: this.width,
        height: this.height,
        goTo: (next) => this.goTo(next),
      });

      // A scene may be swapped out while its enter() is still awaiting.
      if (this.current === scene) scene.resize?.(this.width, this.height);
    } finally {
      this.switching = false;
    }
  }
}
