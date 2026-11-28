import { ColorMatrixFilter, Container, Sprite, Text, Texture, type Renderer } from "pixi.js";
import { ArtState, resolveArt, type ResolvedArt, type ResolvedImage } from "./buildingArt";
import { fortArtFor, type FortArt } from "./fortArt";
import type { YardKind } from "./buildingCostData";
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
  loopAnimLayers,
  resolveAnimLayers,
  restAnimLayers,
  setLayerFrame,
  type AnimLayer,
} from "./YardAnimations";
import { NO_WORK, workUntil, type WorkMap } from "./buildingWork";
import { YardTextures } from "./YardTextures";
import type { YardArtAtlas } from "./yardAtlas";
import type { Rect } from "./YardGrid";
import { spriteBox, unionRect } from "./yardSnapshot";
import { artFor, BuildingCondition, type Yard, type YardBuilding } from "./yardModel";
import { snowContactSprite } from "./snowContact";
import { classicTowerTier, tierPlateImage, tierPlateScale, tierPlateSpot } from "./classicTierPlates";
import { bakeHelpGlow, glowAlpha, helpLook, liftAlpha, litTint, type BakedGlow, type GlowSource } from "./helpGlow";

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
 * A building whose picture has not arrived shows a faint diamond the size of
 * its footprint, so the yard is never full of holes. One whose picture never
 * arrives keeps that diamond and nothing more, as Flash's buildings stayed
 * empty when `ImageCache` gave up on a file: a name written over every
 * failed building piled "Block" over every wall in an unreadable heap. The
 * console says which file failed. Only a building with no art row at all is
 * named, since that is a gap in the art table, not a slow or broken download.
 *
 * `show` itself asks for the pictures the yard needs most, most wanted first
 * (`requestTopsFirst`): every building's own picture before any shadow or
 * animation strip, those on screen before those off it, and among those the
 * pictures the most buildings share, so the walls' one picture comes early.
 * It does not wait for the first frame, which the rest of a big yard's
 * opening can hold back by a second on a busy computer.
 *
 * The one thing here that does change frame to frame is the animation layers —
 * a turret's gun, a mill's wheel. They go into the same container as the tops,
 * immediately after the building they belong to, which puts them above it and
 * below the next building along. They are advanced only while on screen, so a
 * yard scrolled off its towers costs nothing for them, and only while the
 * building is working, so a full harvester or an empty hatchery stands still
 * (#255). `YardAnimations.ts` owns the rest.
 */

/** Culling margin in world pixels: art reaches well past its footprint box. */
const CULL_MARGIN = 160;

/**
 * Upper bound on placeholder labels.
 *
 * Only a building with no art row is labelled, but one `Text` per building
 * would still be 575 display objects with their own textures if a whole type
 * fell out of the art table. The cap keeps that failure cheap; the unlabelled
 * placeholders still show.
 */
const MAX_PLACEHOLDER_LABELS = 60;

/** How strongly a placeholder shows: a faint footprint, not a grey box. */
const PLACEHOLDER_ALPHA = 0.3;

/**
 * How faded a building is drawn under its upgrade preview (`UpgradePreview.ts`):
 * still there, so the ghost reads as what it turns into.
 */
export const UPGRADE_FADE_ALPHA = 0.25;

/** Performance marks around the wait for a yard's pictures; see `markArtReady`. */
const YARD_ART_SHOWN = "yard-art-shown";
const YARD_ART_READY = "yard-art-ready";
const YARD_ART_WAIT = "yard-art";
/**
 * Marked once a page, the first time a yard's every picture (tops, shadows and
 * strips) is in or known missing (`markAllArtReady`): when the yard lets its
 * monsters' sheets and the music start (beta 9). Never cleared, so a load test
 * reads the first yard's.
 */
export const YARD_ART_ALL = "yard-art-all";
let allArtMarked = false;

interface FortOverlay {
  readonly art: FortArt;
  readonly back: Sprite;
  readonly front: Sprite;
  backResolved: boolean;
  frontResolved: boolean;
}

/** Where a building's strip was before a redraw (`show`), to carry on from. */
interface StripPlace {
  readonly url: string;
  readonly frames: number;
  readonly progress: number;
}

interface BuildingView {
  readonly building: YardBuilding;
  readonly art: ResolvedArt | null;
  readonly top: Sprite;
  readonly shadow: Sprite | null;
  /** Christmas: the dark patch on the snow under it (`snowContact.ts`), or null. */
  readonly contact: Sprite | null;
  /**
   * In stacking order; empty for the 78 types that never animate. Replaced
   * wholesale when a battle swaps in damaged art with strips of its own.
   */
  anims: readonly AnimLayer[];
  /** Dropped once the real picture arrives. */
  label: Text | null;
  /** The countdown badge, if this building has one. */
  marker: Sprite | null;
  /** True while a progress bar stands in for the badge (#230); see `hideBadges`. */
  badgeHidden: boolean;
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
  /**
   * The fortification overlay: the back picture stands behind the building, the
   * front in front of it. Null for an unfortified building or a type with no
   * overlay art.
   */
  readonly fort: FortOverlay | null;
  /**
   * The Classic look's tier plate (`classicTierPlates.ts`), in `markers`, and
   * the tier it shows; null and 0 for a building that has none.
   */
  readonly plate: Sprite | null;
  readonly plateTier: number;
  /** True once the plate's picture is on it, or known never to come. */
  plateResolved: boolean;
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
  /** The amber glow behind a building a visitor can speed up (`setHelpLit`), once baked; null otherwise. */
  helpGlow: Sprite | null;
  /** The same glow over the building, adding light (`HelpLook.liftAlpha`); null with none. */
  helpLift: Sprite | null;
  /**
   * The server-clock second this building's strips stop: never for one that
   * runs regardless, or the end of its work — a harvester filling, a hatchery
   * growing (#255, `buildingWork.ts`). Read every frame against the clock.
   */
  workUntil: number;
  /** Whether the strips go back to cell 0 once the work stops (the hatchery). */
  readonly restOnIdle: boolean;
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

/**
 * `BFOUNDATION.highlight`'s colour matrix (`client/scripts/BFOUNDATION.as:3565-3587`):
 * red and green doubled, blue tripled, alpha untouched — the pale blue glow
 * the Flash drop zone put on every building it would land on.
 */
// prettier-ignore
export const HIGHLIGHT_MATRIX = [
  2, 0, 0, 0, 0,
  0, 2, 0, 0, 0,
  0, 0, 3, 0, 0,
  0, 0, 0, 1, 0,
] as const;

/** How many help glows are baked in one frame at most, so a visit opening does not stall a phone. */
const GLOW_BAKES_PER_FRAME = 3;
/** How many baked glows are kept before all are let go. */
const GLOW_CACHE_MAX = 96;
const NONE_LIT: ReadonlyMap<number, number> = new Map();

export class YardBuildings {
  /** Beneath every building. Add to the scene before `tops`. */
  readonly shadows = new Container();
  /** The buildings themselves, in depth order. */
  readonly tops = new Container();
  /** Placeholder names, above everything. */
  readonly labels = new Container();
  /**
   * Whether the next `show` lays a dark patch on the snow under each building
   * (Christmas, `snowContact.ts`). Set by the yard before it shows a yard.
   */
  snowContact = false;
  /** Badges over anything with a countdown running. */
  readonly markers = new Container();

  private readonly textures: YardTextures;
  private views: BuildingView[] = [];
  private readonly byId = new Map<number, BuildingView>();
  /** Which props table the shown yard's art comes from: the Inferno's on an Inferno yard. */
  private kind: YardKind = "main";
  /** Set when art has arrived and the sprites need another resolution pass. */
  private pending = true;
  /** True until every building of the shown yard has its picture; see `markArtReady`. */
  private awaitingArt = false;
  /** True until every picture of the shown yard, shadows and strips too, is in or missing; see `markAllArtReady`. */
  private awaitingAllArt = false;
  /** Told once every picture of the shown yard is in or known missing. */
  private allArtListener: (() => void) | null = null;
  /** The area the last frame drew, for `requestTopsFirst`; null before the first. */
  private lastVisible: Rect | null = null;
  /** Placeholder labels made since the last `show`, against `MAX_PLACEHOLDER_LABELS`. */
  private labelCount = 0;
  /** Told once every building of the shown yard has its picture, or knows it never will. */
  private artReadyListener: (() => void) | null = null;
  /** Buildings drawn highlighted, and the one filter they all share (#88). */
  private readonly highlighted = new Set<number>();
  private highlightFilter: ColorMatrixFilter | null = null;
  /** The building drawn faded under its upgrade preview, if any; see {@link setFaded}. */
  private faded: number | null = null;
  /** What stands among the buildings for a while, kept through a redraw: see `addGuest`. */
  private readonly guests = new Set<Container>();
  /** The tier plates' scale at the camera's zoom (`setZoom`). */
  private plateScale = 1;
  /** How lit each building a visitor can speed up is drawn, by id (`setHelpLit`). */
  private readonly helpLit = new Map<number, number>();
  /** The glows baked so far, by building, place and picture: kept while a visit redraws the yard. */
  private readonly glowCache = new Map<string, BakedGlow>();
  /** The renderer the glows are baked with (`useRenderer`); no glow without one. */
  private glowRenderer: Renderer | null = null;

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

  /**
   * Says when the shown yard's buildings all have their pictures, or know
   * they never will: the yard holds back its bigger downloads till then.
   */
  onArtReady(listener: (() => void) | null): void {
    this.artReadyListener = listener;
  }

  /**
   * Says when the shown yard's every picture, its shadows and animation
   * strips as well as its tops, is in or known missing: the yard's monster
   * sheets and the music wait for it (beta 9).
   */
  onAllArtReady(listener: (() => void) | null): void {
    this.allArtListener = listener;
  }

  /** Buildings still showing a placeholder. */
  get placeholderCount(): number {
    return this.views.reduce((count, view) => count + (view.resolved ? 0 : 1), 0);
  }

  /**
   * Builds the sprites for a yard, replacing whatever was there. `work` says
   * which buildings are working (`buildingWork.ts`); with none, every strip
   * that runs only while working holds still.
   */
  show(yard: Yard, atlas: YardArtAtlas, work: WorkMap = NO_WORK): void {
    // The yard is shown again after every save change — each hatch, each
    // `state` answer — so a strip keeps its place across the redraw rather than
    // starting over: the Inferno's Incubator Control Centre's crystal pulse
    // otherwise jumped back to its dimmest cell, and its lava to liquid yellow,
    // every time one Incubator handed over to the next.
    const places = new Map<number, readonly StripPlace[]>();
    for (const view of this.views) {
      if (view.anims.length === 0) continue;
      places.set(
        view.building.id,
        view.anims.map((layer) => ({ url: layer.anim.url, frames: layer.anim.frames, progress: layer.progress })),
      );
    }
    this.clear();
    this.kind = yard.kind;
    // Only the latest pair is kept: the yard is shown again after every save.
    performance.clearMarks(YARD_ART_SHOWN);
    performance.clearMarks(YARD_ART_READY);
    performance.clearMeasures(YARD_ART_WAIT);
    performance.mark(YARD_ART_SHOWN);
    this.awaitingArt = true;
    this.awaitingAllArt = true;

    for (const building of yard.buildings) {
      const art = artFor(building, yard.kind);

      const fortArt = fortArtFor(building.type, building.fortification);
      let fort: FortOverlay | null = null;
      if (fortArt) {
        // The back goes in before the building and the front after its layers,
        // so the list order reads back, building, strips, front.
        const back = new Sprite(Texture.EMPTY);
        back.visible = false;
        this.tops.addChild(back);
        fort = {
          art: fortArt,
          back,
          front: new Sprite(Texture.EMPTY),
          backResolved: false,
          frontResolved: false,
        };
        fort.front.visible = false;
      }

      const top = new Sprite(atlas.placeholder);
      fillBox(top, building.box);
      top.tint = placeholderTint(building);
      top.alpha = PLACEHOLDER_ALPHA;
      this.tops.addChild(top);

      // Straight after their own top, so depth order still reads down the list.
      const anims = art ? buildAnimLayers(building, art) : [];
      const was = places.get(building.id);
      anims.forEach((layer, index) => {
        const place = was?.[index];
        if (place && place.url === layer.anim.url && place.frames === layer.anim.frames) {
          layer.progress = place.progress;
        }
      });
      for (const layer of anims) this.tops.addChild(layer.sprite);
      if (fort) this.tops.addChild(fort.front);

      // Under the art's own shadow, so the two darken the snow together.
      const contact = this.snowContact ? snowContactSprite(building) : null;
      if (contact) {
        contact.visible = false;
        this.shadows.addChild(contact);
      }

      let shadow: Sprite | null = null;
      if (art?.shadow) {
        shadow = new Sprite(Texture.EMPTY);
        shadow.blendMode = "multiply";
        shadow.visible = false;
        this.shadows.addChild(shadow);
      }

      // The Classic look's tier plate, over the buildings and under the job bars.
      const plateTier = classicTowerTier(building.type, building.level, yard.kind);
      let plate: Sprite | null = null;
      if (plateTier > 0) {
        plate = new Sprite(Texture.EMPTY);
        plate.visible = false;
        this.markers.addChild(plate);
      }

      const view: BuildingView = {
        building,
        art,
        top,
        shadow,
        contact,
        anims,
        fort,
        plate,
        plateTier,
        plateResolved: plate === null,
        // A building with no art row at all is named at once: nothing is coming.
        label: art ? null : this.addLabel(building),
        marker: building.countdown ? this.addCountdownMarker(building, atlas) : null,
        badgeHidden: false,
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
        helpGlow: null,
        helpLift: null,
        workUntil: workUntil(building.type, building.id, work),
        restOnIdle: anims[0]?.policy.restOnIdle === true || anims[0]?.anim.home === true,
      };
      this.views.push(view);
      this.byId.set(building.id, view);
    }

    if (this.guests.size > 0) {
      for (const guest of this.guests) this.tops.addChild(guest);
      this.resortByDepth();
    }
    this.requestTopsFirst(this.lastVisible);
    this.pending = true;
  }

  /**
   * Stands a sprite among the buildings, sorted by its own `zIndex` — a
   * `creepZIndex`, so a building it is behind hides it (#272). For new
   * monsters walking to Housing, which come and go while the yard stays up:
   * a redraw keeps them, and switches the depth sort on again for them. The
   * caller owns the sprite and takes it out with {@link removeGuest}.
   */
  addGuest(child: Container): void {
    // Asked first: Pixi switches sorting on by itself for a child that comes
    // with a `zIndex`, before the buildings have keys of their own.
    const sorted = this.tops.sortableChildren;
    this.guests.add(child);
    this.tops.addChild(child);
    if (!sorted) this.resortByDepth();
  }

  /** Takes out a sprite {@link addGuest} put in, without destroying it. */
  removeGuest(child: Container): void {
    if (!this.guests.delete(child)) return;
    if (child.parent === this.tops) this.tops.removeChild(child);
  }

  /**
   * Says again which buildings are working, without rebuilding anything: for
   * a source handed over after the yard was shown.
   */
  setWork(work: WorkMap): void {
    for (const view of this.views) {
      view.workUntil = workUntil(view.building.type, view.building.id, work);
    }
  }

  /**
   * Applies newly arrived art, advances the animations, then hides everything
   * outside `visible`.
   *
   * The sprites stay in the scene graph either way: culling is a flag, so
   * nothing is created or destroyed while panning. An animation off screen is
   * not advanced at all — it picks up wherever it was left, which nobody can
   * see, and a yard looking at its grass pays nothing for its towers.
   *
   * `now` is the server clock the work ends are on (`setWork`): a building
   * whose work has ended holds its cell, so a harvester that fills between
   * two store changes stops on the frame it fills.
   */
  draw(visible: Rect, deltaSeconds = 0, now = 0): void {
    // Copied into one kept object rather than a new one sixty times a second.
    const last = (this.lastVisible ??= { x: 0, y: 0, width: 0, height: 0 });
    last.x = visible.x;
    last.y = visible.y;
    last.width = visible.width;
    last.height = visible.height;
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
      if (view.contact) view.contact.visible = on;
      if (view.label) view.label.visible = on;
      if (view.fort) {
        const shown = on && view.damageStep < 4;
        view.fort.back.visible = shown && view.fort.backResolved;
        view.fort.front.visible = shown && view.fort.frontResolved;
      }
      if (view.plate) this.placePlate(view, view.plate, on);
      if (view.helpGlow) view.helpGlow.visible = on;
      if (view.helpLift) view.helpLift.visible = on;

      if (view.anims.length === 0) continue;
      for (const layer of view.anims) layer.sprite.visible = animsOn && layer.resolved;
      if (!animsOn || deltaSeconds <= 0) continue;
      // A strip with an idle loop of its own (the Inferno's Incubator Control Centre) runs either way.
      if (view.anims[0]?.anim.rest) loopAnimLayers(view.anims, deltaSeconds, now < view.workUntil);
      else if (now < view.workUntil) advanceAnimLayers(view.anims, deltaSeconds);
      else if (view.restOnIdle) restAnimLayers(view.anims);
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
  /**
   * How many world pixels each shown building's picture rises above the top
   * corner of its footprint, by building id: the ground behind it that the
   * art hides (Thanksgiving turkeys keep off it, `turkeyWalk.ts`). A building
   * whose picture is not in yet, or whose art stays inside its footprint, is
   * left out.
   */
  artRises(): Map<number, number> {
    const rises = new Map<number, number>();
    for (const view of this.views) {
      if (view.hidden || !view.resolved) continue;
      const rise = view.building.box.y + view.offsetY - view.top.y;
      if (rise > 0) rises.set(view.building.id, rise);
    }
    return rises;
  }

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

    for (const sprite of [view.top, view.shadow, view.contact, view.label, view.marker]) {
      if (sprite) sprite.position.set(sprite.position.x + dx, sprite.position.y + dy);
    }
    for (const layer of view.anims) {
      layer.sprite.position.set(layer.sprite.position.x + dx, layer.sprite.position.y + dy);
    }
    if (view.fort) {
      for (const sprite of [view.fort.back, view.fort.front]) {
        sprite.position.set(sprite.position.x + dx, sprite.position.y + dy);
      }
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
    if (view.marker) view.marker.visible = !hidden && !view.badgeHidden;
    if (!hidden) return;
    view.top.visible = false;
    if (view.plate) view.plate.visible = false;
    if (view.shadow) view.shadow.visible = false;
    if (view.contact) view.contact.visible = false;
    if (view.label) view.label.visible = false;
    for (const layer of view.anims) layer.sprite.visible = false;
    if (view.fort) {
      view.fort.back.visible = false;
      view.fort.front.visible = false;
    }
  }

  /**
   * Where each building still shown is drawn, in world pixels: its footprint
   * (moved with it by the planner) and every sprite of it now visible, the
   * tall art, the strips, the shadow and the fortification. Hidden buildings
   * (stored, concealed) give nothing. For the yard picture's framing
   * (`yardSnapshot.ts`), so call it after a `draw` that culled nothing.
   */
  drawnBoxes(): Rect[] {
    const boxes: Rect[] = [];
    for (const view of this.views) {
      if (view.hidden) continue;
      const box = view.building.box;
      const sprites: (Sprite | null)[] = [view.top, view.shadow, ...view.anims.map((layer) => layer.sprite)];
      if (view.fort) sprites.push(view.fort.back, view.fort.front);
      const union = unionRect([
        { x: box.x + view.offsetX, y: box.y + view.offsetY, width: box.width, height: box.height },
        ...sprites.map((sprite) => (sprite ? spriteBox(sprite) : null)),
      ]);
      if (union) boxes.push(union);
    }
    return boxes;
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

    const tint = this.tintOf(view);
    if (view.resolved) view.top.tint = tint;
    for (const layer of view.anims) layer.sprite.tint = tint;
    if (view.fort) {
      view.fort.back.tint = tint;
      view.fort.front.tint = tint;
    }

    const state =
      step >= 4 ? ArtState.DESTROYED : step >= 2 ? ArtState.DAMAGED : ArtState.DEFAULT;
    const wanted = resolveArt(view.building.type, view.building.level, state, this.kind);
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

  /**
   * Shifts one of a building's animation layers by world px, for a gun's
   * recoil in a battle (beta.5 tower attack effects); 0, 0 puts it back.
   */
  nudgeAnim(id: number, layerIndex: number, dx: number, dy: number): void {
    this.byId.get(id)?.anims[layerIndex]?.sprite.pivot.set(-dx, -dy);
  }

  /** The cell one of a building's layers is on, or null when it has no such layer. */
  animFrameOf(id: number, layerIndex: number): number | null {
    const layer = this.byId.get(id)?.anims[layerIndex];
    return layer ? Math.floor(layer.progress) : null;
  }

  /** Whether a building's strips are running at `now` (server clock). */
  isAnimating(id: number, now: number): boolean {
    const view = this.byId.get(id);
    if (!view || view.anims.length === 0 || view.animsSuppressed) return false;
    return view.anims.some((layer) => layer.policy.ticksPerFrame !== null) && now < view.workUntil;
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
      layer.sprite.filters = this.filtersFor(view);
      layer.sprite.alpha = this.alphaOf(view);
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
   * The highest world y a building's art is drawn at: its picture and its
   * animation layers. Where a bar over the building goes (#139). Offsets
   * included.
   *
   * Read from the art table, not from what has been drawn so far: every
   * `show` starts each building on its placeholder, and the bar used to sit
   * on that until the next second's redraw lifted it to the picture — 50 to
   * 70 pixels each time the yard was redrawn, which a build or an upgrade
   * does. Only art that will never arrive falls back to what is drawn.
   *
   * Not the countdown badge: it stands a fixed height above the footprint
   * whatever the art does, so over a low building — a Railgun, a Putty
   * Squisher, Housing — it reached 20 to 45 pixels above the picture and
   * lifted the bar with it, often over the building behind (#230).
   */
  crownOf(id: number): number | null {
    const view = this.byId.get(id);
    if (!view) return null;
    const picture = view.swap?.top ?? view.art?.top;
    let top =
      picture && !this.textures.isMissing(picture)
        ? view.building.worldY + picture.y + view.offsetY
        : view.top.y;
    // A strip's sprite stands where it will be drawn from the start.
    for (const layer of view.anims) {
      if (!this.textures.isStripMissing(layer.anim)) top = Math.min(top, layer.sprite.y);
    }
    return top;
  }

  /**
   * Hides the countdown badge of every building in `ids` and shows the rest
   * again: a building with a progress bar over it needs no badge, and over a
   * low building the two would overlap (#230). Each `show` starts with every
   * badge showing.
   */
  hideBadges(ids: ReadonlySet<number>): void {
    for (const view of this.views) {
      if (!view.marker) continue;
      view.badgeHidden = ids.has(view.building.id);
      view.marker.visible = !view.hidden && !view.badgeHidden;
    }
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
      if (view.fort) {
        view.fort.back.zIndex = base - 4;
        view.fort.front.zIndex = base + 4;
      }
      if (view.helpGlow) view.helpGlow.zIndex = base - 6;
      if (view.helpLift) view.helpLift.zIndex = base + 3;
    }
    this.tops.sortableChildren = true;
    this.tops.sortChildren();
  }

  clear(): void {
    // Guests are their owners' to destroy; `show` puts them back.
    for (const guest of this.guests) this.tops.removeChild(guest);
    for (const layer of [this.shadows, this.tops, this.labels, this.markers]) {
      for (const child of layer.removeChildren()) child.destroy();
    }
    this.tops.sortableChildren = false;
    this.views = [];
    this.byId.clear();
    this.highlighted.clear();
    // The glow sprites went with the tops; their baked pictures stay in `glowCache` for the redraw.
    this.helpLit.clear();
    this.faded = null;
    this.labelCount = 0;
  }

  destroy(): void {
    this.clear();
    this.dropGlowCache();
    this.guests.clear();
    this.highlightFilter?.destroy();
    this.highlightFilter = null;
    this.textures.destroy();
  }

  /**
   * Asks for every building's own picture before anything else, most wanted
   * first: those on screen before those off it, then by how many buildings
   * share the picture. The browser serves requests of one kind in the order
   * they were made, so on a slow link or a busy server the yard fills in by
   * what covers most of the screen (four hundred walls are one request), and
   * the shadows and animation strips `resolveTextures` asks for after these
   * queue behind them rather than among them. With no frame drawn yet there
   * is no screen to go by, and the count alone decides.
   */
  private requestTopsFirst(visible: Rect | null): void {
    const left = visible ? visible.x - CULL_MARGIN : -Infinity;
    const top = visible ? visible.y - CULL_MARGIN : -Infinity;
    const right = visible ? visible.x + visible.width + CULL_MARGIN : Infinity;
    const bottom = visible ? visible.y + visible.height + CULL_MARGIN : Infinity;

    const wanted = new Map<string, { image: ResolvedImage; uses: number; onScreen: boolean }>();
    for (const view of this.views) {
      if (view.resolved || !view.art) continue;
      const image = view.art.top;
      const key = image.frame ? `${image.url}#${image.frame.width}x${image.frame.height}` : image.url;
      const box = view.building.box;
      const onScreen = box.x <= right && box.x + box.width >= left && box.y <= bottom && box.y + box.height >= top;
      const entry = wanted.get(key);
      if (entry) {
        entry.uses++;
        entry.onScreen ||= onScreen;
      } else {
        wanted.set(key, { image, uses: 1, onScreen });
      }
    }
    const order = [...wanted.values()].sort((a, b) => Number(b.onScreen) - Number(a.onScreen) || b.uses - a.uses);
    for (const { image } of order) this.textures.get(image);
  }

  /** A building's name over its placeholder, while the cap allows. */
  private addLabel(building: YardBuilding): Text | null {
    if (this.labelCount >= MAX_PLACEHOLDER_LABELS) return null;
    this.labelCount++;
    const label = new Text({
      text: building.name,
      style: { fontFamily: "Titan One, sans-serif", fontSize: 16, fill: 0xe8eef5 },
    });
    label.anchor.set(0.5);
    label.position.set(building.centreX, building.centreY);
    this.labels.addChild(label);
    return label;
  }

  /** Swaps in whichever pictures have arrived since the last pass. */
  private resolveTextures(): void {
    for (const view of this.views) {
      if (view.fort) this.resolveFort(view.fort, view.building);
      if (!view.plateResolved) this.resolvePlate(view);
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
          view.top.tint = this.tintOf(view);
          view.top.alpha = this.alphaOf(view);
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
    this.markArtReady();
    this.markAllArtReady();
  }

  /**
   * Marks the moment the last building's picture went on, as the performance
   * entry `yard-art` (from `show` to here): how long a player looks at
   * placeholders. Read in the browser's performance panel, or by a load test.
   */
  private markArtReady(): void {
    if (!this.awaitingArt) return;
    if (this.views.some((view) => view.art !== null && !view.resolved && !this.textures.isMissing(view.art.top))) return;
    this.awaitingArt = false;
    performance.mark(YARD_ART_READY);
    performance.measure(YARD_ART_WAIT, YARD_ART_SHOWN, YARD_ART_READY);
    this.artReadyListener?.();
  }

  /** Whether a view still waits for a picture: its top, its shadow or a strip, none known missing. */
  private waitsForArt(view: BuildingView): boolean {
    const art = view.art;
    if (!art) return false;
    if (!view.resolved && !this.textures.isMissing(art.top)) return true;
    if (!view.shadowResolved && view.shadow && art.shadow && !this.textures.isMissing(art.shadow)) return true;
    return view.animsPending;
  }

  /**
   * The first moment the shown yard has all its pictures (`waitsForArt`): the
   * listener is told, and the first time a page the `yard-art-all` mark is set.
   */
  private markAllArtReady(): void {
    if (!this.awaitingAllArt) return;
    if (this.views.some((view) => this.waitsForArt(view))) return;
    this.awaitingAllArt = false;
    if (!allArtMarked) {
      allArtMarked = true;
      performance.mark(YARD_ART_ALL);
    }
    this.allArtListener?.();
  }

  /** Puts a fortification's back and front pictures on their sprites as they arrive. */
  private resolveFort(fort: FortOverlay, building: YardBuilding): void {
    if (!fort.backResolved) {
      const texture = this.textures.get(fort.art.back);
      if (texture) {
        applyArt(fort.back, texture, building, fort.art.back);
        fort.backResolved = true;
      }
    }
    if (!fort.frontResolved) {
      const texture = this.textures.get(fort.art.front);
      if (texture) {
        applyArt(fort.front, texture, building, fort.art.front);
        fort.frontResolved = true;
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
        view.top.tint = this.tintOf(view);
        view.top.alpha = this.alphaOf(view);
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

  /* ── Tier plates, for the Classic look (beta 9) ───────────────────────── */

  /** Tells the tier plates the camera zoom (`YardRenderer.setZoom`): they grow when it zooms out. */
  setZoom(zoom: number): void {
    this.plateScale = tierPlateScale(zoom);
  }

  /** Puts a building's tier plate on, once its picture is in. */
  private resolvePlate(view: BuildingView): void {
    const image = tierPlateImage(view.plateTier);
    if (!view.plate || !image) {
      view.plateResolved = true;
      return;
    }
    const texture = this.textures.get(image);
    if (texture) {
      view.plate.texture = texture;
      view.plateResolved = true;
    } else if (this.textures.isMissing(image)) {
      view.plateResolved = true;
    }
  }

  /**
   * Stands a tier plate on its tower, wherever the planner has moved it, at
   * the camera's plate size; gone with the tower once it is rubble, and while
   * its picture is not in.
   */
  private placePlate(view: BuildingView, plate: Sprite, on: boolean): void {
    const building = view.building;
    plate.visible =
      on &&
      plate.texture !== Texture.EMPTY &&
      view.damageStep < 4 &&
      building.condition !== BuildingCondition.DESTROYED;
    if (!plate.visible) return;
    const [left, top] = tierPlateSpot(building.type, this.kind);
    plate.position.set(building.worldX + left + view.offsetX, building.worldY + top + view.offsetY);
    plate.scale.set(this.plateScale);
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
    view.top.tint = on ? 0xffffff : this.tintOf(view);
  }

  /* ── Lit, for a friend's visit (owner's pick F, 26 Nov 2026) ───────── */

  /** The renderer the help glows are baked with; without one a building is only tinted. */
  useRenderer(renderer: Renderer): void {
    this.glowRenderer = renderer;
  }

  /**
   * Draws each building in `lit` warm amber with a soft amber glow behind it,
   * as lit as its number says (1 standing; Help all's pop flares it past 1
   * and fades it to 0), and puts every other building back. Called every
   * frame on a visit with `YardHelpMarks.lit`; a building whose light has
   * not changed costs a map lookup. The tint is the sprites' own (`helpGlow.ts`),
   * so it stays on through a picture arriving late or the yard being drawn
   * again; the glow is baked once a building, a few a frame.
   */
  setHelpLit(given: ReadonlyMap<number, number>): void {
    const lit = import.meta.env.DEV && helpLook().off ? NONE_LIT : given;
    if (lit.size === 0 && this.helpLit.size === 0) {
      if (this.glowCache.size > 0) this.dropGlowCache();
      return;
    }
    for (const id of [...this.helpLit.keys()]) {
      if (lit.has(id)) continue;
      this.helpLit.delete(id);
      const view = this.byId.get(id);
      if (view) this.applyHelpLit(view);
    }
    let bakes = GLOW_BAKES_PER_FRAME;
    for (const [id, amount] of lit) {
      const view = this.byId.get(id);
      if (!view) continue;
      if (this.helpLit.get(id) !== amount) {
        this.helpLit.set(id, amount);
        this.applyHelpLit(view);
      }
      // Baked once the picture and its strips are in, so the glow has the building's whole outline.
      if (!view.helpGlow && view.resolved && !view.animsPending && bakes > 0 && this.placeGlow(view)) bakes -= 1;
    }
  }

  /** How lit a building is drawn now, 0 for not at all. For checks. */
  helpLitOf(id: number): number {
    return this.helpLit.get(id) ?? 0;
  }

  /** The tint a building is drawn with: its damage step's, warmed while a visitor can help it. */
  private tintOf(view: BuildingView): number {
    return litTint(DAMAGE_TINTS[view.damageStep] ?? 0xffffff, this.helpLit.get(view.building.id) ?? 0);
  }

  /** Puts a building's help light on its sprites: the tint, and the glow's strength or its going. */
  private applyHelpLit(view: BuildingView): void {
    const amount = this.helpLit.get(view.building.id) ?? 0;
    const tint = this.tintOf(view);
    if (view.resolved) view.top.tint = tint;
    for (const layer of view.anims) layer.sprite.tint = tint;
    if (view.fort) {
      view.fort.back.tint = tint;
      view.fort.front.tint = tint;
    }
    if (amount <= 0) {
      view.helpGlow?.destroy();
      view.helpGlow = null;
      view.helpLift?.destroy();
      view.helpLift = null;
      return;
    }
    if (view.helpGlow) view.helpGlow.alpha = glowAlpha(amount);
    if (view.helpLift) view.helpLift.alpha = liftAlpha(amount);
  }

  /**
   * Bakes (or finds) a building's glow and stands it straight behind the
   * building, behind its fortification too. Returns whether it baked one.
   */
  private placeGlow(view: BuildingView): boolean {
    const renderer = this.glowRenderer;
    if (!renderer || view.hidden) return false;
    const sources: GlowSource[] = [];
    const add = (sprite: Sprite): void => {
      if (sprite.texture === Texture.EMPTY) return;
      sources.push({
        texture: sprite.texture,
        x: sprite.x,
        y: sprite.y,
        scaleX: sprite.scale.x,
        scaleY: sprite.scale.y,
        anchorX: sprite.anchor.x,
        anchorY: sprite.anchor.y,
      });
    };
    const parts: string[] = [];
    if (!view.topIsAnim || !view.anims[0]?.resolved) {
      add(view.top);
      parts.push(String(view.top.texture.uid));
    }
    // A strip's cell changes every frame: it is known by its sheet, and the glow keeps the cell it was baked from.
    for (const layer of view.anims) {
      if (!layer.resolved) continue;
      add(layer.sprite);
      parts.push(layer.anim.url);
    }
    if (sources.length === 0) return false;
    const key = `${view.building.id}@${view.top.x},${view.top.y}:${parts.join(",")}`;
    let baked = this.glowCache.get(key) ?? null;
    let fresh = false;
    if (!baked) {
      baked = bakeHelpGlow(renderer, sources);
      if (!baked) return false;
      if (this.glowCache.size >= GLOW_CACHE_MAX) this.dropGlowCache();
      this.glowCache.set(key, baked);
      fresh = true;
    }
    const amount = this.helpLit.get(view.building.id) ?? 0;
    const look = helpLook();
    const glow = new Sprite(baked.texture);
    glow.position.set(baked.x, baked.y);
    glow.tint = look.glowColor;
    glow.alpha = glowAlpha(amount);
    glow.eventMode = "none";
    const behind = view.fort?.back ?? view.top;
    // Sorted by key only once something has asked for it (`resortByDepth`); a key set before that would switch it on.
    const sorted = this.tops.sortableChildren;
    if (sorted) glow.zIndex = view.top.zIndex - 6;
    this.tops.addChildAt(glow, Math.max(0, this.tops.getChildIndex(behind)));
    view.helpGlow = glow;
    if (look.liftAlpha > 0) {
      // Over the building and its strips, under its fortification's front.
      const lift = new Sprite(baked.texture);
      lift.position.set(baked.x, baked.y);
      lift.tint = look.liftColor;
      lift.blendMode = "add";
      lift.alpha = liftAlpha(amount);
      lift.eventMode = "none";
      if (sorted) lift.zIndex = view.top.zIndex + 3;
      const last = view.anims[view.anims.length - 1]?.sprite ?? view.top;
      this.tops.addChildAt(lift, this.tops.getChildIndex(last) + 1);
      view.helpLift = lift;
    }
    return fresh;
  }

  /** Lets every baked glow go: the visit is over, or too many have piled up. */
  private dropGlowCache(): void {
    const live = new Set(this.views.map((view) => view.helpGlow?.texture));
    for (const baked of this.glowCache.values()) {
      if (!live.has(baked.texture)) baked.texture.destroy(true);
    }
    this.glowCache.clear();
  }

  /* ── Highlight, for an armed drop (#88) ─────────────────────────────── */

  /**
   * Draws a building lit up as `BFOUNDATION.highlight` did, or puts it back:
   * the building and its animation layers go through {@link HIGHLIGHT_MATRIX}
   * on top of whatever damage tint they carry. One filter serves every lit
   * building; it is made on first use.
   */
  setHighlight(id: number, on: boolean): void {
    const view = this.byId.get(id);
    if (!view || this.highlighted.has(id) === on) return;
    if (on) this.highlighted.add(id);
    else this.highlighted.delete(id);
    const filters = this.filtersFor(view);
    view.top.filters = filters;
    for (const layer of view.anims) layer.sprite.filters = filters;
    if (view.fort) {
      view.fort.back.filters = filters;
      view.fort.front.filters = filters;
    }
  }

  /** Whether a building is drawn highlighted. */
  isHighlighted(id: number): boolean {
    return this.highlighted.has(id);
  }

  /* ── Faded, under an upgrade preview ────────────────────────────────── */

  /**
   * Draws one building faded (`UPGRADE_FADE_ALPHA`), with its strips, shadow
   * and fortification, under the ghost of its next level, or puts it back
   * when passed null. Kept as state, so a picture or strip that arrives later
   * comes in faded too; `show` puts every building back, and the preview is
   * asked for again after it.
   */
  setFaded(id: number | null): void {
    const before = this.faded;
    if (before === id) return;
    this.faded = id;
    if (before !== null) this.applyFade(before);
    if (id !== null) this.applyFade(id);
  }

  /** The building drawn faded under an upgrade preview, or null. */
  get fadedId(): number | null {
    return this.faded;
  }

  private alphaOf(view: BuildingView): number {
    return this.faded === view.building.id ? UPGRADE_FADE_ALPHA : 1;
  }

  private applyFade(id: number): void {
    const view = this.byId.get(id);
    if (!view) return;
    const alpha = this.alphaOf(view);
    // A placeholder keeps its own see-through grey until the picture is in.
    if (view.resolved) view.top.alpha = alpha;
    if (view.shadow) view.shadow.alpha = alpha;
    if (view.contact) view.contact.alpha = alpha;
    for (const layer of view.anims) layer.sprite.alpha = alpha;
    if (view.fort) {
      view.fort.back.alpha = alpha;
      view.fort.front.alpha = alpha;
    }
  }

  private filtersFor(view: BuildingView): ColorMatrixFilter[] | null {
    if (!this.highlighted.has(view.building.id)) return null;
    if (!this.highlightFilter) {
      this.highlightFilter = new ColorMatrixFilter();
      this.highlightFilter.matrix = [...HIGHLIGHT_MATRIX];
    }
    return [this.highlightFilter];
  }
}
