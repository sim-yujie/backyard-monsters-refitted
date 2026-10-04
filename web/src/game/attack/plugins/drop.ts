/**
 * Attack-scene plugin for the "drop" work package (issue #32, WP4).
 *
 * Mounts tap-to-drop on the enemy yard ({@link AttackInput}), the drop ring
 * it previews, and the two pickers that arm a tool for the next tap: the
 * Catapult's resource bombs and the siege weapons
 * (`docs/design/attack-flow.md` §F3, §F4, §4.2, §4.3, §4.6).
 *
 * ## Where the attacker's own numbers come from
 *
 * A bomb is bought from the *attacker's* pool and a siege weapon comes out of
 * the *attacker's* stock, but the attack load carries the defender's save
 * (`baseLoad.ts` spreads `filteredSave` of the attacked base). The roster
 * the map hands over carries both, from the own-yard load: the siege
 * inventory (`AttackRoster.siege`) and the resource pool
 * (`AttackRoster.resources`). The Flash client read both off the player's
 * own state (`GLOBAL.as:819`, `_attackersResources = GLOBAL._resources`;
 * `SiegeWeapons.importWeapons` from the own save's `siege`). A roster whose
 * save carried no resources offers no bombs rather than guessing.
 *
 * ## Coexistence
 *
 * Opening either picker changes nothing in the army panel; arming a bomb
 * clears an armed siege weapon and vice versa only because one tap drops one
 * thing — the bucket is untouched either way, and un-arming puts the ring
 * back on the bucket. `session.setUnusedTools` is kept equal to the bombs
 * still buyable (one per resource) plus the siege weapons left, so an empty
 * field does not end the attack while there is still something to fire.
 *
 * ## One pool on screen
 *
 * The pool a bomb is bought from lives here, and the HUD shows it through
 * `mounts.showResources` every time it changes (issue #92), so the HUD drops
 * by the bomb's cost the moment the bomb is fired — the same number the
 * Catapult panel's rows read. The server charges the same cost when the
 * attack is saved (#90); nothing here writes it.
 */
import type { Resources } from "@/api/types";
import { ATTACK_PLUGINS, type AttackPlugin } from "@/app/scenes/AttackScene";
import {
  AttackInput,
  parseSiegeStock,
  unusedToolCount,
  type DropPreview,
  type DropTool,
  type SiegeStock,
  type SiegeWeaponId,
  type ToolInventory,
} from "@/game/attack/AttackInput";
import { hudResources, poolOf, spendBomb, type AttackerPool } from "@/game/attack/attackerPool";
import { bucketFor } from "@/game/attack/bucket";
import { DropHighlight } from "@/game/attack/dropHighlight";
import { CatapultPanel } from "@/ui/attack/CatapultPanel";
import { SiegePanel } from "@/ui/attack/SiegePanel";
import { Container, Graphics } from "pixi.js";

/** Ring colours: the success and danger tokens of `tokens.css`. */
const RING_LEGAL = 0x5bbd6a;
const RING_ILLEGAL = 0xe05252;

/**
 * The drop zone's ring, an isometric ellipse in world pixels, green where the
 * drop is legal and red where it is not. Its size is the zone's own `ring`
 * (`dropZoneOf`): the Flash `DROPZONE_CLIP` for a fling or siege weapon, and
 * the blast itself for a bomb.
 */
class DropRing {
  readonly root = new Container();
  private readonly ring = new Graphics();

  constructor() {
    this.root.eventMode = "none";
    this.root.visible = false;
    this.root.addChild(this.ring);
  }

  draw(preview: DropPreview | null, worldOf: (x: number, y: number) => { x: number; y: number }): void {
    const g = this.ring;
    g.clear();
    if (!preview) {
      this.root.visible = false;
      return;
    }
    const at = worldOf(preview.x, preview.y);
    const { rx, ry } = preview.zone.ring;
    const colour = preview.legal ? RING_LEGAL : RING_ILLEGAL;
    g.ellipse(at.x, at.y, rx, ry).fill({ color: colour, alpha: 0.16 });
    g.ellipse(at.x, at.y, rx, ry).stroke({ width: 3, color: colour, alpha: 0.9 });
    g.circle(at.x, at.y, 4).fill({ color: colour, alpha: 0.9 });
    this.root.visible = true;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

const plugin: AttackPlugin = (mounts) => {
  const { session, target, yard, renderer, camera, canvas, dock, notices } = mounts;
  const bucket = bucketFor(session);
  const catapultLevel = target.roster.catapultLevel;

  /* ── The attacker's inventory ─────────────────────────────────────── */

  /** The own-yard resources the pool was read from, for goo and the caps. */
  const held: Resources | null = target.roster.resources;
  let pool: AttackerPool | null = poolOf(held);
  const stock: SiegeStock[] = parseSiegeStock(target.roster.siege);
  const bombsUsed = new Set<number>();
  const siegeUsed: Partial<Record<SiegeWeaponId, number>> = {};

  const inventory = (): ToolInventory => ({
    catapultLevel,
    pool,
    bombsUsed,
    creepsAlive: session.state().creepsAlive,
    siege: stock,
    siegeUsed,
  });

  /* ── The ring ─────────────────────────────────────────────────────── */

  const ring = new DropRing();
  mounts.battleLayer.addChild(ring.root);

  /** The buildings under the ring, lit as Flash lit them (#88). */
  const highlight = new DropHighlight((id, on) => renderer.highlightBuilding(id, on));

  /* ── The pickers ──────────────────────────────────────────────────── */

  const sheet = dock.closest<HTMLElement>(".attack-dock");
  const reportSheet = (): void => {
    if (!sheet || !sheet.classList.contains("attack-dock--sheet")) return;
    mounts.setBottomInset(sheet.getBoundingClientRect().height);
  };

  const tools = document.createElement("div");
  tools.className = "attack-tools";
  tools.setAttribute("role", "group");
  tools.setAttribute("aria-label", "Deployment tools");

  const catapultButton = document.createElement("button");
  catapultButton.type = "button";
  catapultButton.className = "btn attack-tools__button";
  catapultButton.textContent = "Catapult";
  catapultButton.title = "Resource bombs (B)";
  catapultButton.setAttribute("aria-expanded", "false");

  const siegeButton = document.createElement("button");
  siegeButton.type = "button";
  siegeButton.className = "btn attack-tools__button";
  siegeButton.textContent = "Siege";
  siegeButton.title = "Siege weapons (S)";
  siegeButton.setAttribute("aria-expanded", "false");

  tools.append(catapultButton, siegeButton);
  dock.append(tools);

  let catapult: CatapultPanel | null = null;
  let siege: SiegePanel | null = null;

  const armedBomb = (): string | null => {
    const tool = input.pendingTool();
    return tool?.kind === "bomb" ? tool.bomb.id : null;
  };
  const armedSiege = (): SiegeWeaponId | null => {
    const tool = input.pendingTool();
    return tool?.kind === "siege" ? tool.weapon.id : null;
  };

  const live = (): boolean => {
    const phase = session.state().phase;
    return phase === "loaded" || phase === "running";
  };

  /**
   * A picker takes the Army panel's place while it is open (§7 layout table:
   * "Docked right, replaces Army temporarily"), so the Catapult fits without
   * the dock scrolling (#76). The bucket keeps its state underneath and comes
   * back when the picker closes. Only one picker is open at a time, so the
   * dock never stacks panels (#59); closing a picker still cancels the tool it armed.
   */
  const syncDockMode = (): void => {
    sheet?.classList.toggle("attack-dock--picker", catapult !== null || siege !== null);
  };

  /** The HUD's copy of the pool: goo and the rest as read, bombs spent. */
  const showPool = (): void => {
    if (held && pool) mounts.showResources(hudResources(held, pool));
  };

  const refreshPanels = (): void => {
    catapult?.update({
      pool,
      used: bombsUsed,
      creepsAlive: session.state().creepsAlive,
      live: live(),
      armed: armedBomb(),
    });
    siege?.update({ used: siegeUsed, live: live(), armed: armedSiege() });
    catapultButton.classList.toggle("attack-tools__button--armed", armedBomb() !== null);
    siegeButton.classList.toggle("attack-tools__button--armed", armedSiege() !== null);
    session.setUnusedTools(unusedToolCount(inventory()));
  };

  const toggleCatapult = (): void => {
    if (catapult) {
      catapult.close();
      return;
    }
    // One panel in the dock at a time (#59): the other picker makes way.
    siege?.close();
    catapult = new CatapultPanel({
      catapultLevel,
      onPick: (bomb) => input.setTool(bomb ? { kind: "bomb", bomb } : null),
      onClose: () => {
        catapult = null;
        catapultButton.setAttribute("aria-expanded", "false");
        if (armedBomb()) input.setTool(null);
        syncDockMode();
        reportSheet();
      },
    }).mount(dock);
    catapultButton.setAttribute("aria-expanded", "true");
    syncDockMode();
    refreshPanels();
    reportSheet();
  };

  const toggleSiege = (): void => {
    if (siege) {
      siege.close();
      return;
    }
    catapult?.close();
    siege = new SiegePanel({
      stock,
      onPick: (pick) =>
        input.setTool(pick ? { kind: "siege", weapon: pick.spec, level: pick.level } : null),
      onClose: () => {
        siege = null;
        siegeButton.setAttribute("aria-expanded", "false");
        if (armedSiege()) input.setTool(null);
        syncDockMode();
        reportSheet();
      },
    }).mount(dock);
    siegeButton.setAttribute("aria-expanded", "true");
    syncDockMode();
    refreshPanels();
    reportSheet();
  };

  catapultButton.addEventListener("click", toggleCatapult);
  siegeButton.addEventListener("click", toggleSiege);

  /* ── The input ────────────────────────────────────────────────────── */

  const onToolUsed = (tool: Exclude<DropTool, { kind: "fling" }>): void => {
    if (tool.kind === "bomb") {
      bombsUsed.add(tool.bomb.resource);
      if (pool) {
        pool = spendBomb(pool, tool.bomb);
        showPool();
      }
    } else {
      siegeUsed[tool.weapon.id] = (siegeUsed[tool.weapon.id] ?? 0) + 1;
    }
    refreshPanels();
  };

  const input = new AttackInput({
    canvas,
    camera,
    renderer,
    yard,
    session,
    bucket,
    onPreview: (preview) => {
      ring.draw(preview, (x, y) => renderer.yardToWorld(x, y));
      highlight.show(preview?.highlight ?? []);
    },
    onRefuse: (reason) => notices.show("attack-drop", reason, { level: "info", timeoutMs: 2500 }),
    onToolUsed,
    onToolChange: () => refreshPanels(),
    onOpenCatapult: toggleCatapult,
    onOpenSiege: toggleSiege,
  });
  input.attach();

  const unsubscribe = session.subscribe(() => {
    refreshPanels();
    // A building the battle flattens under a still pointer stops being lit.
    input.refresh();
  });
  refreshPanels();
  showPool();

  if (import.meta.env.DEV) {
    (window as unknown as { __attack?: unknown }).__attack = { session, bucket, input };
  }

  return () => {
    unsubscribe();
    input.detach();
    highlight.clear();
    catapult?.close();
    siege?.close();
    tools.remove();
    ring.root.parent?.removeChild(ring.root);
    ring.destroy();
    if (import.meta.env.DEV) {
      delete (window as unknown as { __attack?: unknown }).__attack;
    }
  };
};

ATTACK_PLUGINS.push(plugin);

/** The plugin itself, for the tests. */
export { plugin as dropPlugin };
