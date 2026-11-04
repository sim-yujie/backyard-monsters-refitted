import { Container, Sprite, Text } from "pixi.js";
import type { BattleVisualEvent } from "@/game/combat/rules/engine";
import { TICKS_PER_SECOND } from "@/game/combat/rules/stats";
import { packageArt, type CollectFxArt, type PackageDot } from "@/game/yard/CollectFxLayer";
import { labelPose, LABEL_TICKS } from "./creepFx";
import type { SiegeBuilding } from "./siegeFx";

/**
 * Loot orbs and loot numbers (owner, 4 Nov 2026): what Flash drew each time an
 * attacker took loot from a building (`ATTACK.Loot`, `ATTACK.as:722-733`).
 *
 * - The orb (`ParticleLoot.as`): a resource ball (`ResourcePackage_CLIP`, the
 *   same ball the yard's banks throw) set at the building's anchor, nudged a
 *   random share `r` (-1..1) of 35% of the footprint sideways and down. Its
 *   dot drops onto its shadow with a bounce over a second while the whole
 *   slides another `r` share sideways over two; after 1.5 s it fades out over
 *   half a second. On an Inferno yard the dot is the Inferno's resource
 *   (`param1 += 4`: bone, coal, sulfur, magma). The Vacuum Hose's loot shows
 *   no orb here: the hose draws its own ball (`ParticleVacuumLoot`, `siegeFx`).
 * - The number (`ParticleText.Create(new Point(x, y - 35), amount, type)`,
 *   `ParticleDamageItem.as:36-42`): "+N" in the resource's colour ("-N" when
 *   the yard is the player's own, raided), 35 px above the anchor, rising
 *   25 px over half a second like the damage numbers.
 * - The plop (`bankland`) is the battle sounds' (`attackSounds.ts`).
 *
 * Flash had no cap on orbs; ours keeps {@link LOOT_ORB_MAX} at once so a
 * swarm on a storage building cannot pile up hundreds. Numbers keep Flash's
 * twenty alive (`ParticleText.as:16`), counted apart from the damage numbers.
 * Drawing only: nothing here reaches the battle.
 */

/** An orb's whole life: the slide's two seconds (`ParticleLoot.as:39-43`). */
export const LOOT_ORB_TICKS = 2 * TICKS_PER_SECOND;
/** The dot's bounce onto its shadow: one second. */
export const LOOT_BOUNCE_TICKS = TICKS_PER_SECOND;
/** The fade: from 1.5 s, over half a second (`ParticleLoot.as:22-26`). */
export const LOOT_FADE_FROM = 1.5 * TICKS_PER_SECOND;
/** Orbs alive at once; a new one past this is not drawn (ours, not Flash's). */
export const LOOT_ORB_MAX = 40;
/** Numbers alive at once (`ParticleText.as:16`). */
export const LOOT_LABEL_MAX = 20;
/** World px above the building's anchor a number starts (`ATTACK.as:732`). */
export const LOOT_LABEL_LIFT = 35;
/** The share of the footprint an orb lands off its anchor (`ParticleLoot.as:36-37`). */
const SPREAD = 0.35;

/** `gs.easing.Bounce.easeOut`. */
export const bounceOut = (t: number): number => {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) {
    const u = t - 1.5 / 2.75;
    return 7.5625 * u * u + 0.75;
  }
  if (t < 2.5 / 2.75) {
    const u = t - 2.25 / 2.75;
    return 7.5625 * u * u + 0.9375;
  }
  const u = t - 2.625 / 2.75;
  return 7.5625 * u * u + 0.984375;
};

/** TweenLite's own ease when none is named: `Quad.easeOut`. */
const quadOut = (t: number): number => t * (2 - t);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Where an orb is `age` ticks in, off its building's anchor, in world px. */
export interface LootOrbPose {
  readonly dotX: number;
  readonly dotY: number;
  readonly shadowX: number;
  readonly shadowY: number;
  readonly alpha: number;
}

/**
 * `ParticleLoot.Launch` at `age`: `side` is its random `r` (-1..1),
 * `footprint` the building's in yard units, drawn on screen as a diamond
 * `w + h` px wide and half that high. Without motion the dot sits on its
 * shadow from the start and does not slide.
 */
export const lootOrbPose = (
  age: number,
  side: number,
  footprint: readonly [number, number],
  reducedMotion = false,
): LootOrbPose => {
  const across = (footprint[0] + footprint[1]) * SPREAD;
  const down = ((footprint[0] + footprint[1]) / 2) * SPREAD;
  const slide = reducedMotion ? 0 : quadOut(clamp01(age / LOOT_ORB_TICKS));
  const x = side * across * (1 + slide);
  const top = side * down;
  const ground = down * 1.5;
  const drop = reducedMotion ? 1 : bounceOut(clamp01(age / LOOT_BOUNCE_TICKS));
  const fade = clamp01((age - LOOT_FADE_FROM) / (LOOT_ORB_TICKS - LOOT_FADE_FROM));
  return {
    dotX: x,
    dotY: top + (ground - top) * drop,
    shadowX: x,
    shadowY: ground,
    alpha: 1 - quadOut(fade),
  };
};

const SURFACE_DOTS: readonly PackageDot[] = ["r1", "r2", "r3", "r4"];
const INFERNO_DOTS: readonly PackageDot[] = ["bone", "coal", "sulfur", "magma"];

/** The ball for resource 1-4: the Inferno's on an Inferno yard (`param1 += 4`). */
export const lootDot = (resource: number, inferno: boolean): PackageDot =>
  (inferno ? INFERNO_DOTS : SURFACE_DOTS)[Math.min(3, Math.max(0, resource - 1))]!;

/** `ParticleDamageItem.getLootColor`, resources 1-8. */
const LOOT_COLOURS: readonly number[] = [
  0x723228, 0x999999, 0xff00ff, 0x00ff00, 0xf0e6c5, 0x3f3b36, 0xeeed71, 0xd95300,
];

/** A number's colour for resource 1-4, the Inferno's four after them. */
export const lootColour = (resource: number, inferno: boolean): number =>
  LOOT_COLOURS[Math.min(3, Math.max(0, resource - 1)) + (inferno ? 4 : 0)] ?? 0xffff00;

/** "+N" for an attacker's take, "-N" for what a raid takes off the player. */
export const lootText = (amount: number, raided: boolean): string => `${raided ? "-" : "+"}${amount}`;

/** The plain outline under every number, as `tLootB` sat under `tLootA`. */
const LABEL_STROKE = 0x1a0a0a;
const MODERN_FONT = "Titan One, sans-serif";
const CLASSIC_FONT = "Verdana, Arial, sans-serif";

export interface LootFxHost {
  /** Above the buildings: the orbs and their shadows. */
  air(): Container;
  /** Above everything: the numbers. */
  labels(): Container;
  building(id: number): SiegeBuilding | null;
  /** The camera's zoom, so numbers keep their size on screen; 1 when absent. */
  zoom(): number;
}

export interface LootFxOptions {
  /** Inferno balls and colours. */
  readonly inferno: boolean;
  /** The player's own yard, raided: numbers read "-N". */
  readonly raided?: boolean;
  /** The Classic look: numbers in a plain bold, as the damage numbers. */
  readonly classicFont?: boolean;
  readonly reducedMotion?: boolean;
  readonly art?: CollectFxArt;
  /** 0..1, for where each orb lands; `Math.random` when left out. */
  readonly random?: () => number;
}

interface Orb {
  readonly dot: Sprite;
  readonly shadow: Sprite;
  readonly x: number;
  readonly y: number;
  readonly side: number;
  readonly footprint: readonly [number, number];
  readonly born: number;
}

interface LootLabel {
  readonly text: Text;
  readonly x: number;
  readonly y: number;
  readonly born: number;
}

export class LootFx {
  private readonly host: LootFxHost;
  private readonly art: CollectFxArt;
  private readonly inferno: boolean;
  private readonly raided: boolean;
  private readonly classicFont: boolean;
  private readonly reducedMotion: boolean;
  private readonly random: () => number;
  private readonly shadows = new Container();
  private readonly dots = new Container();
  private readonly texts = new Container();
  private readonly orbs: Orb[] = [];
  private readonly labelList: LootLabel[] = [];
  private attached = false;

  constructor(host: LootFxHost, options: LootFxOptions) {
    this.host = host;
    this.art = options.art ?? packageArt();
    this.inferno = options.inferno;
    this.raided = options.raided ?? false;
    this.classicFont = options.classicFont ?? false;
    this.reducedMotion = options.reducedMotion ?? false;
    this.random = options.random ?? Math.random;
    for (const layer of [this.shadows, this.dots, this.texts]) layer.eventMode = "none";
  }

  /** What is on screen, for tests. */
  get shown(): { orbs: number; labels: number; texts: readonly string[] } {
    return {
      orbs: this.orbs.length,
      labels: this.labelList.length,
      texts: this.labelList.map((label) => label.text.text),
    };
  }

  /** One of the battle's events; only loot draws. */
  onEvent(event: BattleVisualEvent): void {
    if (event.kind !== "loot") return;
    const building = this.host.building(event.buildingId);
    if (!building) return;
    this.attach();
    if (!event.vacuum && this.orbs.length < LOOT_ORB_MAX) this.addOrb(building, event.resource, event.tick);
    if (this.labelList.length < LOOT_LABEL_MAX) this.addLabel(building, event.resource, event.amount, event.tick);
  }

  /** Moves everything to `tick`; what has run its life goes. */
  update(tick: number): void {
    for (let index = this.orbs.length - 1; index >= 0; index -= 1) {
      const orb = this.orbs[index]!;
      const age = tick - orb.born;
      if (age >= LOOT_ORB_TICKS) {
        orb.dot.destroy();
        orb.shadow.destroy();
        this.orbs.splice(index, 1);
        continue;
      }
      const pose = lootOrbPose(Math.max(0, age), orb.side, orb.footprint, this.reducedMotion);
      orb.dot.position.set(orb.x + pose.dotX, orb.y + pose.dotY);
      orb.shadow.position.set(orb.x + pose.shadowX, orb.y + pose.shadowY);
      orb.dot.alpha = pose.alpha;
      orb.shadow.alpha = pose.alpha;
    }
    const zoom = this.host.zoom();
    const scale = zoom > 0 ? 1 / zoom : 1;
    for (let index = this.labelList.length - 1; index >= 0; index -= 1) {
      const label = this.labelList[index]!;
      const age = tick - label.born;
      if (age > LABEL_TICKS) {
        label.text.destroy();
        this.labelList.splice(index, 1);
        continue;
      }
      const pose = labelPose(Math.max(0, age));
      label.text.scale.set(scale);
      label.text.position.set(Math.round(label.x), Math.round(label.y - (this.reducedMotion ? 0 : pose.rise)));
      label.text.alpha = pose.alpha;
    }
  }

  destroy(): void {
    this.shadows.destroy({ children: true });
    this.dots.destroy({ children: true });
    this.texts.destroy({ children: true });
    this.orbs.length = 0;
    this.labelList.length = 0;
    this.art.destroy();
  }

  private attach(): void {
    if (this.attached) return;
    this.attached = true;
    const air = this.host.air();
    air.addChild(this.shadows, this.dots);
    this.host.labels().addChild(this.texts);
  }

  private addOrb(building: SiegeBuilding, resource: number, tick: number): void {
    const dot = new Sprite(this.art.dot(lootDot(resource, this.inferno)));
    const shadow = new Sprite(this.art.shadow);
    for (const sprite of [dot, shadow]) {
      sprite.anchor.set(0.5);
      sprite.eventMode = "none";
    }
    this.shadows.addChild(shadow);
    this.dots.addChild(dot);
    const orb: Orb = {
      dot,
      shadow,
      x: building.worldX,
      y: building.worldY,
      side: this.random() * 2 - 1,
      footprint: building.footprint,
      born: tick,
    };
    this.orbs.push(orb);
    const pose = lootOrbPose(0, orb.side, orb.footprint, this.reducedMotion);
    dot.position.set(orb.x + pose.dotX, orb.y + pose.dotY);
    shadow.position.set(orb.x + pose.shadowX, orb.y + pose.shadowY);
  }

  private addLabel(building: SiegeBuilding, resource: number, amount: number, tick: number): void {
    const text = new Text({
      text: lootText(amount, this.raided),
      style: {
        // Titan One has one weight, already bold (as the damage numbers).
        fontFamily: this.classicFont ? CLASSIC_FONT : MODERN_FONT,
        ...(this.classicFont ? { fontWeight: "bold" as const } : {}),
        fontSize: 13,
        fill: lootColour(resource, this.inferno),
        stroke: { color: LABEL_STROKE, width: 3 },
      },
    });
    text.anchor.set(0.5, 1);
    text.eventMode = "none";
    this.texts.addChild(text);
    const label: LootLabel = { text, x: building.worldX, y: building.worldY - LOOT_LABEL_LIFT, born: tick };
    this.labelList.push(label);
    text.position.set(Math.round(label.x), Math.round(label.y));
  }
}
