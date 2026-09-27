import { Container, Sprite, Text, Texture } from "pixi.js";
import { ArtState, resolveArt, type ResolvedArt } from "./buildingArt";
import {
  applyArt,
  fillBox,
  inBox,
  inDiamond,
  pickBySpriteBox,
  placeholderTint,
  type SpriteBoxCandidate,
} from "./yardPlacement";
import {
  advanceAnimLayers,
  buildAnimLayers,
  resolveAnimLayers,
  setLayerFrame,
  type AnimLayer,
} from "./YardAnimations";
import { YardTextures } from "./YardTextures";
import type { YardArtAtlas } from "./yardAtlas";
import type { Rect } from "./YardGrid";
import { artFor, type Yard, type YardBuilding } from "./yardModel";

/**
 * The building sprites: one per building, built once and never rebuilt.
 *
 * A read-only yard never changes shape. Every position, footprint box and depth
 * key is computed when the save is parsed (`yardModel.ts`), so this makes the
 * whole draw list at open time in depth order and from then on a frame is
 * nothing but `visible` flags. Panning costs one transform on the parent rather
 * than 575 reprojections, which is what keeps a full yard at the vsync floor.
 *
 * Shadows live in their own container beneath every building rather than
 * interleaved by depth, which is what the Flash client did —
 * `MAP.DEPTH_SHADOW` is 1, below everything (`client/scripts/MAP.as:102`) — and
 * they are drawn with a multiply blend because the files are JPEGs with no
 * alpha channel (`client/scripts/BFOUNDATION.as:1108`).
 *
 * A building whose picture has not arrived, or never will, shows a diamond the
 * size of its footprint with its name on it. The yard is therefore never full
 * of holes, and a broken asset path is visible rather than silent.
 *
 * The one thing here that does change frame to frame is the animation layers —
 * a turret's gun, a mill's wheel. They go into the same container as the tops,
 * immediately after the building they belong to, which puts them above it and
 * below the next building along. They are advanced only while on screen, so a
 * yard scrolled off its towers costs nothing for them. `YardAnimations.ts` owns
 * the rest.
 */

/** Culling margin in world pixels: art reaches well past its footprint box. */
const CULL_MARGIN = 160;

/**
 * Upper bound on placeholder labels.
 *
 * One `Text` per building would be 575 display objects with their own textures
 * if the asset server were down. The cap keeps the failure mode cheap; the
 * unlabelled placeholders still show, and the scene reports the real count.
 */
const MAX_PLACEHOLDER_LABELS = 60;

interface BuildingView {
  readonly building: YardBuilding;
  readonly art: ResolvedArt | null;
  readonly top: Sprite;
  readonly shadow: Sprite | null;
  /**
   * In stacking order; empty for the 78 types that never animate. Replaced
   * wholesale when a battle swaps in damaged art with strips of its own.
   */
  anims: readonly AnimLayer[];
  /** Dropped once the real picture arrives. */
  label: Text | null;
  /** The countdown badge, if this building has one. */
  marker: Sprite | null;
  /**
   * World pixels this building is drawn away from where the save put it.
   *
   * Zero for every building outside the planner. The planner moves buildings by
   * translating their existing sprites rather than rebuilding the draw list,
   * because a drag of 400 walls has to stay at the vsync floor and destroying
   * and recreating 400 sprites per pointer move does not.
   */
  offsetX: number;
  offsetY: number;
  /**
   * True while the planner holds this building in its drawer.
   *
   * A stored building is drawn nowhere and picks up nowhere, but it keeps its
   * sprites: storing four hundred walls and undoing it would otherwise be two
   * full rebuilds of the draw list.
   */
  hidden: boolean;
  /** True once the real picture is on the sprite. */
  resolved: boolean;
  /**
   * True once the shadow is on its sprite, or immediately for a building that
   * has none.
   *
   * Tracked apart from `resolved` because the two images are separate fetches
   * that finish in either order: a single flag would stop asking for the shadow
   * the moment the building itself arrived.
   */
  shadowResolved: boolean;
  /** True while any animation strip is still on its way. */
  animsPending: boolean;
  /**
   * True when the still top is only cell 0 of the first strip, so it has to go
   * once that strip is playing. Types 22, 53, 105 and 129.
   */
  readonly topIsAnim: boolean;
  /**
   * How battered the building is drawn, 0 (untouched) to 4 (destroyed); see
   * `damageStep`. Zero for every building outside a live battle: the read-only
   * yard draws the save's condition through `art` and never calls `setDamage`.
   */
  damageStep: number;
  /**
   * Art a live battle has swapped in over `art` — the damaged or destroyed
   * state — with the flags that say whether its top and shadow have arrived.
   * Null until `setDamage` asks for a state the building was not saved in.
   */
  swap: ResolvedArt | null;
  swapResolved: boolean;
  swapShadowResolved: boolean;
  /** True once a swap has taken the animation layers off: a ruin does not turn. */
  animsSuppressed: boolean;
}

/**
 * The tint a building is drawn with at each damage step: white untouched,
 * then three darker greys as its health falls through 75, 50 and 25 percent,
 * and the darkest for a ruin. Step 0 is what every sprite already gets, so a
 * yard that never takes damage draws exactly as before.
 */
export const DAMAGE_TINTS: readonly number[] = [0xffffff, 0xdcdcdc, 0xb8b8b8, 0x949494, 0x7a7a7a];

/**
 * The damage step for a health fraction: 0 at or above 75 percent, 1 below
 * it, 2 below 50, 3 below 25, and 4 at zero. Anything not a finite number
 * counts as untouched, which is what a building with no health ladder is.
 */
export const damageStep = (fraction: number): number => {
  if (!Number.isFinite(fraction) || fraction >= 0.75) return 0;
  if (fraction <= 0) return 4;
  if (fraction < 0.25) return 3;
  if (fraction < 0.5) return 2;
  return 1;
};

export class YardBuildings {
  /** Beneath every building. Add to the scene before `tops`. */
  readonly shadows = new Container();
  /** The buildings themselves, in depth order. */
  readonly tops = new Container();
  /** Placeholder names, above everything. */
  readonly labels = new Container();
  /** Badges over anything with a countdown running. */
  readonly markers = new Container();

  private readonly textures: YardTextures;
  private views: BuildingView[] = [];
  private readonly byId = new Map<number, BuildingView>();
  /** Set when art has arrived and the sprites need another resolution pass. */
  private pending = true;

  constructor() {
    this.textures = new YardTextures(() => {
      this.pending = true;
    });
    for (const layer of [this.shadows, this.tops, this.markers]) layer.eventMode = "none";
  }

  /**
   * The texture cache, so the blueprint can draw the same pictures on its
   * tiles without fetching or cutting any of them a second time.
   */
  get art(): YardTextures {
    return this.textures;
  }

  /** Buildings still showing a placeholder. */
  get placeholderCount(): number {
    return this.views.reduce((count, view) => count + (view.resolved ? 0 : 1), 0);
  }

  /** Builds the sprites for a yard, replacing whatever was there. */
  show(yard: Yard, atlas: YardArtAtlas): void {
    this.clear();

    let labels = 0;

    for (const building of yard.buildings) {
      const art = artFor(building);

      const top = new Sprite(atlas.placeholder);
      fillBox(top, building.box);
      top.tint = placeholderTint(building);
      top.alpha = 0.55;
      this.tops.addChild(top);

      // Straight after their own top, so depth order still reads down the list.
      const anims = art ? buildAnimLayers(building, art) : [];
      for (const layer of anims) this.tops.addChild(layer.sprite);

      let shadow: Sprite | null = null;
      if (art?.shadow) {
        shadow = new Sprite(Texture.EMPTY);
        shadow.blendMode = "multiply";
        shadow.visible = false;
        this.shadows.addChild(shadow);
      }

      let label: Text | null = null;
      if (labels < MAX_PLACEHOLDER_LABELS) {
        labels++;
        label = new Text({
          text: building.name,
          style: { fontFamily: "Nunito, sans-serif", fontSize: 16, fill: 0xe8eef5 },
        });
        label.anchor.set(0.5);
        label.position.set(building.centreX, building.centreY);
        this.labels.addChild(label);
      }

      const view: BuildingView = {
        building,
        art,
        top,
        shadow,
        anims,
        label,
        marker: building.countdown ? this.addCountdownMarker(building, atlas) : null,
        offsetX: 0,
        offsetY: 0,
        hidden: false,
        resolved: false,
        shadowResolved: shadow === null,
        animsPending: anims.length > 0,
        topIsAnim: art?.topIsAnim === true,
        damageStep: 0,
        swap: null,
        swapResolved: true,
        swapShadowResolved: true,
        animsSuppressed: false,
      };
      this.views.push(view);
      this.byId.set(building.id, view);
    }

    this.pending = true;
  }

  /**
   * Applies newly arrived art, advances the animations, then hides everything
   * outside `visible`.
   *
   * The sprites stay in the scene graph either way: culling is a flag, so
   * nothing is created or destroyed while panning. An animation off screen is
   * not advanced at all — it picks up wherever it was left, which nobody can
   * see, and a yard looking at its grass pays nothing for its towers.
   */
  draw(visible: Rect, deltaSeconds = 0): void {
    if (this.pending) {
      this.pending = false;
      this.resolveTextures();
    }

    const left = visible.x - CULL_MARGIN;
    const top = visible.y - CULL_MARGIN;
    const right = visible.x + visible.width + CULL_MARGIN;
    const bottom = visible.y + visible.height + CULL_MARGIN;

    for (const view of this.views) {
      const box = view.building.box;
      const boxX = box.x + view.offsetX;
      const boxY = box.y + view.offsetY;
      const on =
        !view.hidden &&
        boxX <= right &&
        boxX + box.width >= left &&
        boxY <= bottom &&
        boxY + box.height >= top;
      // A building drawn entirely from its first strip keeps its still top only
      // until that strip is playing; both at once would show cell 0 through the
      // transparent parts of every other cell.
      const animsOn = on && !view.animsSuppressed;
      view.top.visible =
        on && !(view.topIsAnim && animsOn && view.anims[0]?.resolved === true);
      if (view.shadow) view.shadow.visible = on && view.shadowResolved;
      if (view.label) view.label.visible = on;

      if (view.anims.length === 0) continue;
      for (const layer of view.anims) layer.sprite.visible = animsOn && layer.resolved;
      if (animsOn && deltaSeconds > 0) advanceAnimLayers(view.anims, deltaSeconds);
    }
  }

  /**
   * The building under a world point, or null.
   *
   * Walks the draw list backwards so the topmost building wins, and tests the
   * footprint diamond rather than its box so a click in the gap between two
   * towers does not pick one of them.
   *
   * Tall art reaches well above its footprint — a Hatchery, a Monster Lab, a
   * Storage Silo — so a diamond miss falls through to a second pass over the
   * resolved sprites' own bounding boxes (issue #41); `pickBySpriteBox` in
   * `yardPlacement.ts` has the tie-break rules. Placeholders sit out of this
   * pass because their box is exactly the footprint the first pass already
   * ruled out. Hover runs this every pointer move, so the second pass only
   * allocates a candidate for a sprite that has already passed both the box
   * test and the "rises above its footprint" test — cheap property reads, no
   * allocation, for every building that can't be the answer.
   */
  pick(worldX: number, worldY: number): YardBuilding | null {
    for (let i = this.views.length - 1; i >= 0; i--) {
      const view = this.views[i];
      if (!view || view.hidden) continue;
      // Test against where the building is *drawn*, which in the planner is not
      // where the save put it.
      const x = worldX - view.offsetX;
      const y = worldY - view.offsetY;
      const box = view.building.box;
      if (x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height) continue;
      if (inDiamond(view.building, x, y)) return view.building;
    }

    const candidates: SpriteBoxCandidate[] = [];
    for (let i = this.views.length - 1; i >= 0; i--) {
      const view = this.views[i];
      if (!view || view.hidden || !view.resolved) continue;
      const sprite = view.top;
      const footprintTop = view.building.box.y + view.offsetY;
      if (sprite.y >= footprintTop) continue; // art does not rise above its footprint
      const box: Rect = { x: sprite.x, y: sprite.y, width: sprite.width, height: sprite.height };
      if (!inBox(worldX, worldY, box)) continue;
      candidates.push({ building: view.building, box, footprintTop });
    }
    return pickBySpriteBox(worldX, worldY, candidates);
  }

  /* ── Moving, for the planner ────────────────────────────────────────── */

  /**
   * Draws a building `(worldX, worldY)` pixels away from where the save put it.
   *
   * Every sprite the building owns — picture, shadow, animation strips,
   * placeholder label and countdown badge — shifts by the same amount, because
   * an isometric translation is a translation on screen and nothing has to be
   * reprojected. The offset is absolute rather than incremental so a drag can
   * re-issue it on every pointer move without accumulating drift.
   */
  offsetBuilding(id: number, worldX: number, worldY: number): void {
    const view = this.byId.get(id);
    if (!view || (view.offsetX === worldX && view.offsetY === worldY)) return;

    const dx = worldX - view.offsetX;
    const dy = worldY - view.offsetY;
    view.offsetX = worldX;
    view.offsetY = worldY;

    for (const sprite of [view.top, view.shadow, view.label, view.marker]) {
      if (sprite) sprite.position.set(sprite.position.x + dx, sprite.position.y + dy);
    }
    for (const layer of view.anims) {
      layer.sprite.position.set(layer.sprite.position.x + dx, layer.sprite.position.y + dy);
    }
  }

  /**
   * Shows or hides one building, for the planner's drawer.
   *
   * The culling pass in `draw` reads the flag, but it only runs in the
   * isometric view and only when a frame is drawn, so the sprites are switched
   * here as well: a building stored while the blueprint is showing has to be
   * gone the moment the player switches back.
   */
  setHidden(id: number, hidden: boolean): void {
    const view = this.byId.get(id);
    if (!view || view.hidden === hidden) return;
    view.hidden = hidden;
    // The countdown badge is not culled, so `draw` never touches it: it is the
    // one sprite that has to be switched in both directions here.
    if (view.marker) view.marker.visible = !hidden;
    if (!hidden) return;
    view.top.visible = false;
    if (view.shadow) view.shadow.visible = false;
    if (view.label) view.label.visible = false;
    for (const layer of view.anims) layer.sprite.visible = false;
  }

  /** Puts every hidden building back. What leaving the planner does. */
  showAll(): void {
    for (const view of this.views) view.hidden = false;
  }

  /* ── Damage, for a live battle ──────────────────────────────────────── */

  /**
   * Draws a building as battered as `fraction` of its health says
   * (issue #32, WP5).
   *
   * The tint darkens a step at 75, 50 and 25 percent (`DAMAGE_TINTS`), the
   * damaged art goes on below half and the destroyed art at zero, the same
   * states a saved yard shows through `artFor`. The swap is a texture fetch
   * like any other, so the ruin appears when its picture does and the tinted
   * whole building stands in until then. A step already applied costs a map
   * lookup; the battle layer calls this for every building whose health
   * changed, several times a second.
   *
   * The read-only yard never calls this, and a building at step 0 is drawn
   * exactly as it always was.
   */
  setDamage(id: number, fraction: number): void {
    const view = this.byId.get(id);
    if (!view) return;
    const step = damageStep(fraction);
    if (view.damageStep === step) return;
    view.damageStep = step;

    const tint = DAMAGE_TINTS[step] ?? 0xffffff;
    if (view.resolved) view.top.tint = tint;
    for (const layer of view.anims) layer.sprite.tint = tint;

    const state =
      step >= 4 ? ArtState.DESTROYED : step >= 2 ? ArtState.DAMAGED : ArtState.DEFAULT;
    const wanted = resolveArt(view.building.type, view.building.level, state);
    const current = view.swap ?? view.art;
    if (!wanted || wanted === current || wanted.top.url === current?.top.url) {
      // Same picture as now (a type with one state, or a wall at every level):
      // the tint alone tells the story, and a ruin still stops its wheels.
      view.animsSuppressed = step >= 4;
      return;
    }
    view.swap = wanted;
    view.swapResolved = false;
    view.swapShadowResolved = false;
    view.animsSuppressed = wanted.anims.length === 0;
    // Damaged art ships strips of its own — a battered gun on a battered
    // tower — so the layers are rebuilt from them; the undamaged strip would
    // otherwise go on turning over the ruin below it (issue #67).
    if (wanted.anims.length > 0) this.rebuildAnims(view, wanted, tint);
    this.pending = true;
  }

  /**
   * Puts one of a building's animation layers on a cell, for a battle turning
   * a tower toward its target (issue #67); see `setLayerFrame`. A layer index
   * the building does not have is ignored.
   */
  setAnimFrame(id: number, layerIndex: number, frame: number): void {
    const layer = this.byId.get(id)?.anims[layerIndex];
    if (layer) setLayerFrame(layer, frame);
  }

  /** The cell one of a building's layers is on, or null when it has no such layer. */
  animFrameOf(id: number, layerIndex: number): number | null {
    const layer = this.byId.get(id)?.anims[layerIndex];
    return layer ? Math.floor(layer.progress) : null;
  }

  /** How many animation layers a building has right now. */
  animLayerCount(id: number): number {
    return this.byId.get(id)?.anims.length ?? 0;
  }

  /**
   * Replaces a building's animation layers with those of another art state.
   *
   * The new sprites go exactly where the old ones were in the draw list, so
   * depth order still reads down it in the read-only yard and the sorted
   * container keeps its keys, and each takes over the cell its predecessor
   * was showing so a turret does not snap to a new facing as it is hit.
   */
  private rebuildAnims(view: BuildingView, art: ResolvedArt, tint: number): void {
    const previous = view.anims;
    const fresh = buildAnimLayers(view.building, art);
    let at = this.tops.getChildIndex(view.top) + 1;
    fresh.forEach((layer, index) => {
      const old = previous[index];
      if (old) layer.progress = old.progress;
      layer.sprite.position.set(
        layer.sprite.position.x + view.offsetX,
        layer.sprite.position.y + view.offsetY,
      );
      layer.sprite.zIndex = view.top.zIndex + index + 1;
      layer.sprite.tint = tint;
      this.tops.addChildAt(layer.sprite, Math.min(at, this.tops.children.length));
      at += 1;
    });
    for (const layer of previous) {
      this.tops.removeChild(layer.sprite);
      layer.sprite.destroy();
    }
    view.anims = fresh;
    view.animsPending = fresh.length > 0;
  }

  /**
   * The highest world y anything of a building is drawn at: its picture (or
   * placeholder), any animation layer that has arrived, and its countdown
   * badge. Where a bar over the building goes (#139). Offsets included.
   */
  crownOf(id: number): number | null {
    const view = this.byId.get(id);
    if (!view) return null;
    let top = view.top.y;
    for (const layer of view.anims) {
      if (layer.resolved) top = Math.min(top, layer.sprite.y);
    }
    if (view.marker) top = Math.min(top, view.marker.y - view.marker.height);
    return top;
  }

  /** The offset a building is currently drawn at. */
  offsetOf(id: number): { x: number; y: number } {
    const view = this.byId.get(id);
    return view ? { x: view.offsetX, y: view.offsetY } : { x: 0, y: 0 };
  }

  /**
   * Re-sorts the draw list so moved buildings stack correctly again.
   *
   * Only worth doing when a move is committed: during a drag the group is
   * briefly drawn through its neighbours, which reads as "picked up" and costs
   * nothing, while re-sorting 575 sprites per pointer move would not.
   */
  resortByDepth(): void {
    for (const view of this.views) {
      const base = (view.building.depth + view.offsetY * 4_000_000 + view.offsetX * 1_000) * 8;
      view.top.zIndex = base;
      view.anims.forEach((layer, index) => (layer.sprite.zIndex = base + index + 1));
    }
    this.tops.sortableChildren = true;
    this.tops.sortChildren();
  }

  clear(): void {
    for (const layer of [this.shadows, this.tops, this.labels, this.markers]) {
      for (const child of layer.removeChildren()) child.destroy();
    }
    this.tops.sortableChildren = false;
    this.views = [];
    this.byId.clear();
  }

  destroy(): void {
    this.clear();
    this.textures.destroy();
  }

  /** Swaps in whichever pictures have arrived since the last pass. */
  private resolveTextures(): void {
    for (const view of this.views) {
      if (view.swap && !(view.swapResolved && view.swapShadowResolved)) this.resolveSwap(view);
      if (view.resolved && view.shadowResolved && !view.animsPending) continue;
      const art = view.art;
      if (!art) continue;

      if (view.animsPending) {
        view.animsPending = resolveAnimLayers(view.anims, this.textures);
      }

      if (!view.resolved) {
        const texture = this.textures.get(art.top);
        if (texture) {
          applyArt(view.top, texture, view.building, art.top);
          view.top.tint = DAMAGE_TINTS[view.damageStep] ?? 0xffffff;
          view.top.alpha = 1;
          view.resolved = true;

          view.label?.destroy();
          view.label = null;
        }
      }

      if (!view.shadowResolved && view.shadow && art.shadow) {
        const shadowTexture = this.textures.get(art.shadow);
        if (shadowTexture) {
          applyArt(view.shadow, shadowTexture, view.building, art.shadow);
          view.shadow.visible = true;
          view.shadowResolved = true;
        }
      }
    }
  }

  /**
   * Puts a battle's damaged or destroyed picture on a building once it has
   * arrived. The top and the shadow are separate fetches, resolved apart; a
   * state that ships no shadow takes the old one away.
   */
  private resolveSwap(view: BuildingView): void {
    const swap = view.swap;
    if (!swap) return;
    if (!view.swapResolved) {
      const texture = this.textures.get(swap.top);
      if (texture) {
        applyArt(view.top, texture, view.building, swap.top);
        view.top.tint = DAMAGE_TINTS[view.damageStep] ?? 0xffffff;
        view.top.alpha = 1;
        view.resolved = true;
        view.swapResolved = true;
        view.label?.destroy();
        view.label = null;
      } else if (this.textures.isMissing(swap.top)) {
        view.swapResolved = true;
      }
    }
    if (view.swapShadowResolved) return;
    const shadow = view.shadow;
    if (!shadow) {
      view.swapShadowResolved = true;
      return;
    }
    if (!swap.shadow) {
      shadow.visible = false;
      view.shadowResolved = false;
      view.swapShadowResolved = true;
      return;
    }
    const shadowTexture = this.textures.get(swap.shadow);
    if (shadowTexture) {
      applyArt(shadow, shadowTexture, view.building, swap.shadow);
      shadow.visible = true;
      view.shadowResolved = true;
      view.swapShadowResolved = true;
    } else if (this.textures.isMissing(swap.shadow)) {
      view.swapShadowResolved = true;
    }
  }

  /** A badge over anything mid-build, mid-upgrade or mid-fortify. */
  private addCountdownMarker(building: YardBuilding, atlas: YardArtAtlas): Sprite {
    const marker = new Sprite(atlas.working);
    marker.anchor.set(0.5, 1);
    marker.position.set(building.centreX, building.box.y - 6);
    marker.tint = building.countdown?.kind === "build" ? 0xffd479 : 0x8fd0ff;
    this.markers.addChild(marker);
    return marker;
  }

  /* ── Hit flash, for a live battle (#63) ─────────────────────────────── */

  /**
   * Draws a building lit up for the frames after a monster strikes it, or
   * puts it back. A tint can only darken, so the flash is the top sprite
   * drawn additively over the ground for a moment; off restores the tint of
   * whatever damage step the building is at. A placeholder is left alone.
   */
  setFlash(id: number, on: boolean): void {
    const view = this.byId.get(id);
    if (!view || !view.resolved) return;
    view.top.blendMode = on ? "add" : "normal";
    view.top.tint = on ? 0xffffff : (DAMAGE_TINTS[view.damageStep] ?? 0xffffff);
  }
}
