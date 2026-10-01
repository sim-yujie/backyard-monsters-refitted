import { logout } from "@/api/auth";
import { loadOwnYard } from "@/api/base";
import { ApiError, NetworkError } from "@/api/http";
import {
  loadMapRoom1,
  mapRoom1Refusal,
  NOT_MAP_ROOM_1,
  type MapRoom1Response,
} from "@/api/maproom1";
import type { BaseLoadResponse } from "@/api/types";
import { setAttackTarget, setViewTarget, type AttackTarget } from "@/game/attack/attackTarget";
import { Mr1Guide } from "@/game/guide/mr1Guide";
import { takePrimedOwnYard } from "@/game/maproom/mapRoute";
import {
  attackGate,
  FLINGER_TYPE,
  mr1AttackTarget,
  readMapRoom1,
  readOwn,
  type Mr1Own,
  type Mr1Target,
  type Mr1World,
} from "@/game/maproom1/mr1Model";
import { setYardIntent } from "@/game/yard/yardIntent";
import { MapRoom1Ui } from "@/ui/maproom1/MapRoom1Ui";
import type { CardAction } from "@/ui/maproom1/TargetCard";
import { MonstersTabId } from "@/ui/monsters/monstersTab";
import type { Scene, SceneContext } from "../SceneManager";
import { SceneName } from "../App";

/**
 * Map Room 1: the neighbours and the four wild monster tribes, for a player
 * who has not moved to Map Room 2 (issue #132).
 *
 * Wiring only: the own-yard load says what you could send and whether your
 * Flinger works, the Map Room 1 route says who is out there, `mr1Model` turns
 * both into words and `MapRoom1Ui` draws them. The one policy here is the
 * refresh clock: the route is asked again every {@link REFRESH_SECONDS} while
 * the screen is on screen and the tab is visible, as the Flash map re-asked
 * every 15-20 s while it was open (`PlayerLayer.as:88-90`, `:148`), and at
 * once when a wrecked camp's countdown runs out.
 */

/** How often the neighbours and tribes are asked for again. */
export const REFRESH_SECONDS = 18;

/** DEV only: `?mr1fixture` draws the screen from a fixture instead of the route. */
const useFixture = (): boolean =>
  import.meta.env.DEV &&
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("mr1fixture");

export class MapRoom1Scene implements Scene {
  private context: SceneContext | null = null;
  private ui: MapRoom1Ui | null = null;
  /** Bob, while the guided start's practice camp is open (issue #227). */
  private guide: Mr1Guide | null = null;
  private ownSave: BaseLoadResponse | null = null;
  private own: Mr1Own | null = null;
  private world: Mr1World | null = null;
  /** Server seconds minus browser seconds, from the last answer. */
  private clockOffset = 0;
  private sinceRefresh = 0;
  private sinceTick = 0;
  private fetching = false;
  /** Respawn times already refreshed for, so a late answer does not loop. */
  private readonly respawnsSeen = new Set<number>();

  async enter(context: SceneContext): Promise<void> {
    this.context = context;
    this.ui = new MapRoom1Ui(
      {
        onSceneSelect: (id) => context.goTo(id),
        onSignOut: () => {
          logout();
          context.goTo(SceneName.LOGIN);
        },
        onClose: () => context.goTo(SceneName.YARD),
        onView: (target) => this.view(target),
        onAttack: (target) => this.attack(target),
        onAction: (action) => this.act(action),
      },
      SceneName.MAP_ROOM_1,
      [
        { id: SceneName.MAP_ROOM_1, label: "Map" },
        { id: SceneName.YARD, label: "Yard" },
      ],
    ).mount(context.overlay.content);
    this.guide = new Mr1Guide(context.overlay.guide, {
      goHome: () => context.goTo(SceneName.YARD),
      refresh: () => void this.refresh(),
    });

    document.addEventListener("visibilitychange", this.onVisibility);
    await this.loadOwn();
    await this.refresh();
    if (this.context === context) this.ui?.announce();
  }

  exit(): void {
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.guide?.destroy();
    this.guide = null;
    this.ui?.destroy();
    this.ui = null;
    this.context = null;
  }

  resize(): void {
    // The views measure themselves on window resize.
  }

  update(deltaSeconds: number): void {
    if (!this.world) return;
    this.sinceTick += deltaSeconds;
    if (this.sinceTick >= 1) {
      this.sinceTick = 0;
      const now = this.now();
      this.ui?.tick(now);
      const back = this.world.tribes.find(
        (tribe) =>
          tribe.wrecked &&
          tribe.respawnAt !== null &&
          tribe.respawnAt <= now &&
          !this.respawnsSeen.has(tribe.respawnAt),
      );
      if (back?.respawnAt != null) {
        this.respawnsSeen.add(back.respawnAt);
        void this.refresh();
      }
    }
    if (document.visibilityState !== "visible") return;
    this.sinceRefresh += deltaSeconds;
    if (this.sinceRefresh >= REFRESH_SECONDS) void this.refresh();
  }

  private now(): number {
    return Math.floor(Date.now() / 1000 + this.clockOffset);
  }

  private async loadOwn(): Promise<void> {
    try {
      // The load that chose this map, when there was one (issue #162).
      const save = takePrimedOwnYard() ?? (await loadOwnYard());
      if (!this.context) return;
      this.ownSave = save;
      this.own = readOwn(save);
      if (typeof save.currenttime === "number")
        this.clockOffset = save.currenttime - Date.now() / 1000;
      if (save.resources) this.ui?.setResources(save.resources, save.credits);
    } catch (caught) {
      this.failed(
        caught,
        "own-yard",
        "Could not load your yard, so what you can send is not known.",
        () => void this.loadOwn(),
      );
    }
  }

  /** Asks for the neighbours and tribes again; one request at a time. */
  private async refresh(): Promise<void> {
    if (this.fetching) return;
    this.fetching = true;
    this.sinceRefresh = 0;
    try {
      const response: MapRoom1Response = useFixture()
        ? (await import("@/game/maproom1/mr1Fixture")).mapRoom1Fixture(this.now())
        : await loadMapRoom1();
      if (!this.context) return;
      const world = readMapRoom1(response, this.now());
      this.clockOffset = world.now - Date.now() / 1000;
      this.world = world;
      this.ui?.notices.clear("mr1-load");
      this.ui?.setStatus(null);
      this.ui?.setData(world, this.own, this.now());
      this.guide?.update(world);
    } catch (caught) {
      // The server says this player is on Map Room 2 now: that is their map.
      if (mapRoom1Refusal(caught) === NOT_MAP_ROOM_1) {
        this.context?.goTo(SceneName.MAP_ROOM_2);
        return;
      }
      // The first failure leaves the map with you on it and nothing else.
      if (!this.world) {
        this.world = { now: this.now(), tribes: [], neighbours: [], protectedUntil: 0 };
        this.ui?.setStatus(null);
        this.ui?.setData(this.world, this.own, this.now());
      }
      this.failed(
        caught,
        "mr1-load",
        "Could not load your neighbours and the wild monster tribes.",
        () => void this.refresh(),
      );
    } finally {
      this.fetching = false;
    }
  }

  private failed(caught: unknown, key: string, message: string, retry: () => void): void {
    if (caught instanceof ApiError && caught.isAuthFailure) {
      this.context?.goTo(SceneName.LOGIN);
      return;
    }
    this.ui?.notices.show(
      key,
      caught instanceof NetworkError ? "Could not reach the server." : message,
      {
        level: "warning",
        actionLabel: "Retry",
        onAction: retry,
      },
    );
  }

  /**
   * The attack on `target` as it stands now, or the reason there is none. The
   * gate is asked again here rather than trusted from the card, because a
   * refresh may have changed the target since the card was drawn.
   */
  private attackOn(target: Mr1Target): { attack: AttackTarget | null; refusal: string | null } {
    const world = this.world ?? { protectedUntil: 0 };
    const now = this.now();
    const attack = mr1AttackTarget(target, this.ownSave, world, now);
    if (attack) return { attack, refusal: null };
    const reason = attackGate(target, this.own, world, now).reason;
    return {
      attack: null,
      refusal: reason ? `${reason.title}. ${reason.detail}` : "This target cannot be attacked.",
    };
  }

  /**
   * Hands the target to the attack scene, which issues the attack load
   * (`mapversion: 1`) and runs the fight. The server has the last word: a
   * refusal it sends (protection, online, a wrecked tribe) is shown there.
   */
  private attack(target: Mr1Target): void {
    const context = this.context;
    if (!context) return;
    const { attack, refusal } = this.attackOn(target);
    if (!attack) {
      this.ui?.notices.show("attack", refusal ?? "This target cannot be attacked.", {
        level: "info",
        timeoutMs: 5_000,
      });
      return;
    }
    setAttackTarget(attack);
    context.goTo(SceneName.ATTACK);
  }

  /**
   * Opens the target's yard read-only in the yard scene, the same visit Map
   * Room 2 uses, with Map Room 1 named on the load so a tribe's `wmview`
   * finds the Map Room 1 camp. The attack it could turn into rides along, so
   * the visit's own Attack button needs nothing from this screen.
   */
  private view(target: Mr1Target): void {
    const context = this.context;
    if (!context) return;
    const save = this.ownSave;
    const { attack, refusal } = this.attackOn(target);
    setViewTarget({
      baseid: target.baseid,
      kind: target.kind === "tribe" ? "wild" : "main",
      name: target.name,
      mapversion: 1,
      attack,
      refusal,
      own: save ? { resources: save.resources ?? null, credits: save.credits } : undefined,
    });
    context.goTo(SceneName.YARD);
  }

  /** A card's way out: the Build window on the Flinger, or the Hatch tab. */
  private act(action: CardAction): void {
    setYardIntent(
      action === "buildFlinger"
        ? { kind: "build", type: FLINGER_TYPE }
        : { kind: "monsters", tab: MonstersTabId.HATCH },
    );
    this.context?.goTo(SceneName.YARD);
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "visible" && this.sinceRefresh >= REFRESH_SECONDS / 2)
      void this.refresh();
  };
}
