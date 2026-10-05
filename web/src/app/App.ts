import { Application, Container } from "pixi.js";
import { createOverlay, type Overlay } from "@/ui/overlay";
import { PerfOverlay } from "@/ui/PerfOverlay";
import { SceneManager, type SceneFactory } from "./SceneManager";
import { withHold, withPresence } from "./presenceScene";
import { withIdle } from "./idleScene";
import { IdleWatch, idleDurationText, idleTimingsFor } from "@/game/presence/idleWatch";
import { IdleWarning } from "@/ui/IdleWarning";
import { getAuthToken, onAnswer } from "@/api/http";
import { stayProtected } from "@/api/presence";
import { ProtectionWatch, protectionTimingsFor } from "@/game/presence/protectionWatch";
import { yardAttack } from "@/game/presence/yardAttack";
import { StayProtectedPrompt } from "@/ui/StayProtectedPrompt";
import { answerBotCheck, fetchBotCheck, forceBotCheck } from "@/api/botCheck";
import { BotCheckWatch } from "@/game/presence/botCheckWatch";
import { BotCheckCard } from "@/ui/BotCheckCard";
import { BootScene } from "./scenes/BootScene";
import { LoginScene } from "./scenes/LoginScene";
import { MapGateScene } from "./scenes/MapGateScene";
import { MapRoom1Scene } from "./scenes/MapRoom1Scene";
import { MapRoom2Scene } from "./scenes/MapRoom2Scene";
import { YardScene } from "./scenes/YardScene";
import { AttackScene } from "./scenes/AttackScene";
import { AwayScene } from "./scenes/AwayScene";
import { BAITER_PLUGINS, BAITER_REPLAY_PLUGINS } from "@/game/baiter/baiterPlugin";
import { WATCH_PLUGINS } from "@/game/autoAttack/watchPlugin";

/** Loads Titan One (#223) before anything draws canvas text with it; see the
 * comment in `start()`. `document.fonts` is missing in some test environments
 * (jsdom), so this is a no-op there rather than a thrown error. */
async function loadTitanOne(): Promise<void> {
  const fonts = (document as { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  try {
    await fonts.load('400 16px "Titan One"');
  } catch {
    // Fallback stack takes over; see the comment in `start()`.
  }
}

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
   * A finished Baiter test played back (#22, WP5): the attack scene with only
   * the battle layer and the Baiter's package, opened through
   * `game/baiter/testHistory`. Nothing on it talks to the server.
   */
  BAITER_REPLAY: "baiter-replay",
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
  private protection: ProtectionWatch | null = null;
  private stayPrompt: StayProtectedPrompt | null = null;
  private botCheck: BotCheckWatch | null = null;
  private botCheckCard: BotCheckCard | null = null;
  private stopHearing: (() => void) | null = null;

  constructor(private readonly host: HTMLElement) {
    this.pixi = new Application();
    this.stage = new Container();
  }

  async start(): Promise<void> {
    // Titan One (#223) is drawn straight to canvas by Phaser/Pixi text and
    // bitmap-font atlases (YardBuildings, YardJobBars, YardHatchMarks,
    // creepFx, LabelLayer, BlueprintLayer). Canvas text, unlike DOM text,
    // does not get redrawn when a web font finishes loading after the first
    // paint, so a scene built before the font is ready would be stuck
    // showing the fallback sans-serif. Nothing in index.html's markup is a
    // text node, so the browser has no reason to start fetching the font on
    // its own; this is what asks for it. Best-effort: an old browser without
    // the Font Loading API, or a font request that fails, still renders —
    // just with the fallback stack from --font-display/--font-body.
    await loadTitanOne();

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

    // "Stay protected?" nine minutes after the last real game action (#275),
    // on the server's clock. Every answer carrying `lastAction` moves it: the
    // presence ping's, the tap's, and every real action's own. A dev build
    // takes `?protect=40,20` (seconds) to test.
    const prompt = new StayProtectedPrompt(this.host, () => protection.stay());
    const protection = new ProtectionWatch({
      timings: protectionTimingsFor(window.location.search, import.meta.env.DEV),
      onShow: (endsAt) => prompt.show(endsAt),
      onHide: () => prompt.hide(),
      stay: stayProtected,
      account: getAuthToken,
    });
    this.protection = protection;
    this.stayPrompt = prompt;

    // The in-game check (#273): the server asks for one when it sees bot-like
    // play, and says so as `checkPending` on the ping's answer and on every
    // real action's. It comes before both prompts: "Stay protected?" waits
    // while it is up (a tap would protect nothing), and so does "Still
    // there?", whose disconnect still comes on time.
    const card = new BotCheckCard(this.host, (option) => botCheck.choose(option));
    let idleWarnAt: number | null = null;
    let checkUp = false;
    const holdBack = (): void => protection.suppress(idleWarnAt !== null || checkUp);
    const botCheck = new BotCheckWatch({
      fetch: fetchBotCheck,
      answer: answerBotCheck,
      onShow: (view) => {
        checkUp = true;
        warning.hide();
        holdBack();
        card.show(view);
      },
      onHide: () => {
        checkUp = false;
        card.hide();
        if (idleWarnAt !== null) warning.show(idleWarnAt);
        holdBack();
      },
      account: getAuthToken,
    });
    this.botCheck = botCheck;
    this.botCheckCard = card;

    this.stopHearing = onAnswer(({ lastAction, now, checkPending }) => {
      if (typeof lastAction === "number") {
        protection.hear({ lastAction, ...(typeof now === "number" && { now }) });
      }
      if (typeof checkPending === "boolean") botCheck.hear(checkPending);
    });

    // Ten minutes without input disconnects (#271). The 10 and the 1 minute
    // are `IDLE_TIMINGS`; a dev build takes `?idle=40,20` (seconds) to test.
    // Its "Still there?" comes first: "Stay protected?" waits while it is up,
    // and its button answers both when both are due.
    const scenes = this.scenes;
    const warning = new IdleWarning(this.host, Date.now, () => {
      if (protection.due) protection.stay().catch(() => {});
    });
    const idle = new IdleWatch({
      timings: idleTimingsFor(window.location.search, import.meta.env.DEV),
      onWarn: (disconnectAt) => {
        idleWarnAt = disconnectAt;
        holdBack();
        if (!checkUp) warning.show(disconnectAt);
      },
      onCancelWarn: () => {
        idleWarnAt = null;
        warning.hide();
        holdBack();
      },
      onDisconnect: () => {
        protection.stop();
        botCheck.stop();
        scenes.goTo(SceneName.AWAY);
      },
    });
    this.idle = idle;
    this.idleWarning = warning;
    if (import.meta.env.DEV) {
      const dev = globalThis as Record<string, unknown>;
      dev["__idle"] = idle;
      dev["__protection"] = protection;
      dev["__yardAttack"] = yardAttack;
      // `__botCheck.force()` asks a local server for a check now (#273).
      dev["__botCheck"] = { watch: botCheck, force: forceBotCheck };
    }

    // Every screen past sign-in keeps the player online (#242, `presenceScene.ts`)
    // and is watched for the idle disconnect, which an attack or a replay
    // (the Baiter's practice and a Watch included) holds off until it is left.
    const game = (factory: SceneFactory, defer = false): SceneFactory =>
      withPresence(withHold(withHold(withIdle(factory, idle, { defer }), protection), botCheck));
    this.scenes
      .register(SceneName.BOOT, () => new BootScene())
      .register(SceneName.LOGIN, () => new LoginScene())
      .register(SceneName.MAP, game(() => new MapGateScene()))
      .register(SceneName.MAP_ROOM_1, game(() => new MapRoom1Scene()))
      .register(SceneName.MAP_ROOM_2, game(() => new MapRoom2Scene()))
      .register(SceneName.YARD, game(() => new YardScene()))
      .register(SceneName.ATTACK, game(() => new AttackScene(), true))
      .register(SceneName.BAITER, game(() => new AttackScene(BAITER_PLUGINS, { practice: true }), true))
      .register(
        SceneName.BAITER_REPLAY,
        game(() => new AttackScene(BAITER_REPLAY_PLUGINS, { practice: true }), true),
      )
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
    if (import.meta.env.DEV) {
      const dev = globalThis as Record<string, unknown>;
      delete dev["__idle"];
      delete dev["__protection"];
      delete dev["__yardAttack"];
      delete dev["__botCheck"];
    }
    this.idleWarning?.hide();
    this.idleWarning = null;
    this.stopHearing?.();
    this.stopHearing = null;
    this.protection?.stop();
    this.protection = null;
    this.stayPrompt?.hide();
    this.stayPrompt = null;
    this.botCheck?.stop();
    this.botCheck = null;
    this.botCheckCard?.hide();
    this.botCheckCard = null;
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
