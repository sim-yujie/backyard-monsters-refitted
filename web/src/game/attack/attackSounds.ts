import {
  AERIAL_DEFENSE_TYPE,
  LASER_TYPE,
  QUAKE_ANIM_FRAMES,
  QUAKE_TOWER_TYPE,
  RAILGUN_TYPE,
  TESLA_TYPE,
  isSpurtzCannon,
  trapStats,
  type BattleVisualEvent,
} from "@/game/combat/rules";
import { DAVE_ID } from "@/game/combat/rules/specialMoves";
import { FOMOR_ID } from "@/game/combat/rules/champions";
import { ATTACK_EFFECTS, type Effect } from "@/game/sound/EffectsPlayer";

/**
 * An attack's sounds, as Flash played them (players asked for them back,
 * beta 6). Each is Flash's own file, started by the same thing that started
 * it in Flash, at Flash's volume:
 *
 * | Flash call                                          | Sound                          | Here                     |
 * | --------------------------------------------------- | ------------------------------ | ------------------------ |
 * | Cannon Tower `Fire` (`BUILDING20.as:26`)            | `splash1`                      | `shot`, type 20          |
 * | Sniper Tower `Fire` (`BUILDING21.as:35-41`)         | `snipe1`, `isniper` (Inferno)  | `shot`, type 21          |
 * | Laser Tower `Fire` (`BUILDING23.as:46`)             | `laser`                        | `shot`, type 23          |
 * | Tesla Tower (`BUILDING25.as:94,155,159-184`)        | `lightningstart/fire/end`      | `charge`, `shot`, `coilRest` |
 * | Aerial Defense `Fire` (`BUILDING115.as:125`)        | `snipe1`                       | `shot`, type 115         |
 * | Railgun `Fire` (`BUILDING118.as:132`)               | `railgun1`                     | `shot`, type 118         |
 * | Inferno Cannon `Fire` (`INFERNO_CANNON_TOWER.as:35`)| `icannon`                      | `shot`, type 130         |
 * | Magma Tower, Spurtz Cannon (`INFERNO_MAGMA_TOWER.as:57-62`, `SpurtzCannon.as:174`) | `magma1`/`magma2` | `shot` |
 * | Quake Tower wind-up (`INFERNOQUAKETOWER.as:113`)    | `quake`                        | `towerCell` 6 from the end |
 * | Monster Bunker door (`BUILDING22.as:437-447`)       | `bunkerdoor`                   | `bunkerDoor`, both ways  |
 * | A monster's swing (`CreepBase.tickBAttack:944-956`) | `hit1-4`, `ihit1-7`, 0.1-0.2   | `hit`, attackers only    |
 * | Champion's swing (`ChampionBase.as:812`, `Fomor.as:154`) | `hit4`, Fomor `hit1-3`    | `hit`                    |
 * | A shooter reaching its target (`CreepBase.as:1482`), an Inferno defender (`:1063,1541`) | `imonster1-4` | `hit` on a new target |
 * | Korath's quake (`Korath.as:176`)                    | `quake`, 0.4                   | `quake`                  |
 * | A monster dying (`MonsterBase.dieFinish`, `deathSplat`) | `monsterland1-3` + `splat1-3`; D.A.V.E. `monsterlanddave` | the splat |
 * | A champion knocked out (`ChampionBase.as:784`)      | `monsterland1-3`               | the splat                |
 * | Wormzer under / up (`MonsterBase.renderBurrow`)     | `dig` / `arise`, 0.5           | the dig                  |
 * | A building damaged / falling (`BFOUNDATION.as:1070-1092`) | `damage1-3` / `destroy1-4` by level, `destroytownhall` | the smoke puff |
 * | A resource bomb thrown (`ResourceBombs.Trigger`)    | `twigbomb/pebblebomb/puttybomb`| the bomb's drop          |
 * | A trap (`BTRAP.as:147`, `BHEAVYTRAP.as:109`)        | `trap`                         | the trap's reveal        |
 *
 * A tower with a siege Jar on it plays at 0.4, as Flash's `isJard` did.
 * Flash never played `warcry1` or `Rezghul_Fire_Damage` (they are in the
 * folder, not in any call), so neither is here.
 *
 * Only the choosing is here; {@link EffectsPlayer} plays them, keeps them
 * from rattling, and stays silent with sound effects off.
 */

export type PlaySound = (effect: Effect, volume?: number) => void;

export interface AttackSoundsOptions {
  readonly play: PlaySound;
  /** An Inferno yard (`BASE.isInfernoMainYardOrOutpost`): the Sniper's Inferno shot. */
  readonly inferno: boolean;
  /** A yard building's type and level, by id. */
  readonly building: (id: number) => { readonly type: number; readonly level: number } | undefined;
  /** A creep's monster id and side, by creep id, while it is on the field. */
  readonly creepOf: (creepId: number) => { readonly monsterId: string; readonly friendly: boolean } | undefined;
  /** Whether a siege Jar sits on the tower: Flash's `isJard`, its shots at half volume. */
  readonly jarred?: (towerId: number) => boolean;
  /** `Math.random` unless a test fixes it. */
  readonly random?: () => number;
}

/** The Inferno-only sounds, fetched only for an Inferno yard. */
const INFERNO_ONLY: ReadonlySet<Effect> = new Set<Effect>([
  "icannon",
  "isniper",
  "ihit1",
  "ihit2",
  "ihit3",
  "ihit4",
  "ihit5",
  "ihit6",
  "ihit7",
]);

/** The attack sounds an attack on this kind of yard fetches as it opens. */
export const attackSoundsFor = (inferno: boolean): readonly Effect[] =>
  inferno ? ATTACK_EFFECTS : ATTACK_EFFECTS.filter((effect) => !INFERNO_ONLY.has(effect));

const TOWN_HALL = 14;
const CANNON_TYPE = 20;
const SNIPER_TYPE = 21;
const INFERNO_CANNON_TYPE = 130;
const MAGMA_TOWER_TYPE = 132;
const FULL = 0.8;
const JARRED = 0.4;

/** `SOUNDS.DamageSoundIDForLevel`. */
export const damageSoundFor = (level: number): Effect =>
  level < 3 ? "damage1" : level < 6 ? "damage2" : "damage3";

/** `SOUNDS.DestroySoundIDForLevel`. */
export const destroySoundFor = (level: number): Effect =>
  level < 2 ? "destroy1" : level < 5 ? "destroy2" : level < 8 ? "destroy3" : "destroy4";

export class AttackSounds {
  private readonly play: PlaySound;
  private readonly inferno: boolean;
  private readonly building: AttackSoundsOptions["building"];
  private readonly creepOf: AttackSoundsOptions["creepOf"];
  private readonly jarred: (towerId: number) => boolean;
  private readonly random: () => number;
  /** What each creep last swung at, so a shooter growls once per target. */
  private readonly lastTarget = new Map<number, string>();

  constructor(options: AttackSoundsOptions) {
    this.play = options.play;
    this.inferno = options.inferno;
    this.building = options.building;
    this.creepOf = options.creepOf;
    this.jarred = options.jarred ?? (() => false);
    this.random = options.random ?? Math.random;
  }

  /** One of the battle's events, as the battle layer reads it. */
  onEvent(event: BattleVisualEvent): void {
    switch (event.kind) {
      case "shot":
        this.onShot(event.towerId);
        return;
      case "charge":
        this.play("lightningstart", this.towerVolume(event.towerId));
        return;
      case "coilRest":
        this.play("lightningend", this.towerVolume(event.towerId));
        return;
      case "towerCell":
        if (event.cell === QUAKE_ANIM_FRAMES - 6 && this.building(event.towerId)?.type === QUAKE_TOWER_TYPE) {
          this.play("quake", this.towerVolume(event.towerId));
        }
        return;
      case "bunkerDoor":
        this.play("bunkerdoor");
        return;
      case "quake":
        this.play("quake", 0.4);
        return;
      case "hit":
        this.onHit(event);
        return;
      case "death":
        this.lastTarget.delete(event.creepId);
        return;
      default:
        return;
    }
  }

  /** A creep's death, as its splat shows (or a champion's fall). */
  onDeath(death: { readonly monsterId: string; readonly champion: boolean }): void {
    this.play(this.pick("monsterland", 1, 3));
    if (death.champion) return;
    if (death.monsterId === DAVE_ID) this.play("monsterlanddave");
    else this.play(this.pick("splat", 1, 3));
  }

  /** A building crossed into its damaged look (under half health) or fell. */
  onBuilding(id: number, crossed: "damaged" | "destroyed"): void {
    const building = this.building(id);
    if (!building) return;
    // A trap's going off is its own sound (`onTrap`).
    if (trapStats(building.type)) return;
    if (crossed === "damaged") this.play(damageSoundFor(building.level));
    else if (building.type === TOWN_HALL) this.play("destroytownhall");
    else this.play(destroySoundFor(building.level));
  }

  /** A trap went off; `heavy` layers the Modern look's Heavy Trap fall over it. */
  onTrap(heavy = false): void {
    this.play("trap");
    if (heavy) this.play("trapheavy");
  }

  /** A resource bomb was thrown: `resource` 1 twigs, 2 pebbles, 3 putty. */
  onBomb(resource: number): void {
    if (resource === 1) this.play("twigbomb");
    else if (resource === 2) this.play("pebblebomb");
    else if (resource === 3) this.play("puttybomb");
  }

  /** A Wormzer went under (true) or came up (false). */
  onBurrow(under: boolean): void {
    this.play(under ? "dig" : "arise");
  }

  private onShot(towerId: number): void {
    const type = this.building(towerId)?.type;
    if (type === undefined) return;
    const volume = this.towerVolume(towerId);
    if (type === CANNON_TYPE) this.play("splash1", volume);
    else if (type === SNIPER_TYPE) this.play(this.inferno ? "isniper" : "snipe1", volume);
    else if (type === LASER_TYPE) this.play("laser", volume);
    else if (type === TESLA_TYPE) this.play("lightningfire", volume);
    else if (type === AERIAL_DEFENSE_TYPE) this.play("snipe1", volume);
    else if (type === RAILGUN_TYPE) this.play("railgun1", volume);
    // These three never checked `isJard`.
    else if (type === INFERNO_CANNON_TYPE) this.play("icannon");
    else if (type === MAGMA_TOWER_TYPE || isSpurtzCannon(type)) this.play(this.random() < 0.5 ? "magma1" : "magma2");
  }

  private onHit(event: Extract<BattleVisualEvent, { kind: "hit" }>): void {
    const creep = this.creepOf(event.creepId);
    if (creep === undefined) return;
    const monster = creep.monsterId;
    const target = event.buildingId >= 0 ? `b${event.buildingId}` : `c${event.creepTargetId}`;
    const fresh = this.lastTarget.get(event.creepId) !== target;
    this.lastTarget.set(event.creepId, target);
    const infernoMonster = monster.startsWith("I");
    // A shooter coming into range growls, any monster in Flash's `move`; an Inferno defender growls on its foe.
    if (fresh && (creep.friendly ? infernoMonster : event.ranged)) this.play(this.pick("imonster", 1, 4));
    // The defenders' swings were silent (`tickBDefend`).
    if (creep.friendly) return;
    this.play(this.hitSound(monster), 0.1 + this.random() * 0.1);
  }

  /** `CreepBase.as:944-956`: by the monster's number, the Inferno's own set, a champion's thump. */
  private hitSound(monster: string): Effect {
    if (monster.startsWith("I")) return this.pick("ihit", 1, 7);
    if (monster === FOMOR_ID) return this.pick("hit", 1, 3);
    if (monster.startsWith("G")) return "hit4";
    const number = Number.parseInt(monster.slice(1), 10);
    if (number < 5) return this.pick("hit", 1, 3);
    if (number < 10) return this.pick("hit", 3, 4);
    return "hit4";
  }

  /** `name + int(from + Math.random() * count)`, from `from` to `to`. */
  private pick<P extends string>(prefix: P, from: number, to: number): Effect {
    const take = from + Math.min(to - from, Math.floor(this.random() * (to - from + 1)));
    return `${prefix}${take}` as Effect;
  }

  private towerVolume(towerId: number): number {
    return this.jarred(towerId) ? JARRED : FULL;
  }
}
