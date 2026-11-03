import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { watchEvents, watchTarget } from "@/game/autoAttack/watchRun";
import { fixtureRun, type DefenceReplayFixture } from "@/game/defences/defenceFixture";
import { CLIENT_RULES_VERSION } from "@/game/defences/defenceWatch";
import type { Effect } from "@/game/sound/EffectsPlayer";
import { readYard } from "@/game/yard/yardModel";
import { AttackBattleLayer, MonsterSheetTextures } from "./AttackBattleLayer";
import { AttackSession } from "./AttackSession";
import { MONSTER_SPRITES } from "./monsterSpriteData";
import { sheetUrl } from "./monsterSprites";

/**
 * The battle layer's attack sounds (`attackSounds.ts`) on a real battle: a
 * recorded defence with towers, a bunker and mixed waves. Watched, it sounds
 * Flash's shots, swings, deaths and falls, in both looks; skipped to the
 * end, nothing more sounds.
 */

const FIXTURE = fileURLToPath(new URL("../../../test/fixtures/defence-replay-mixed-waves.json", import.meta.url));
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as DefenceReplayFixture;

const BATTLE_TIMEOUT_MS = 30_000;

const blankSheet = (url: string): Promise<Texture> => {
  const sheet = Object.values(MONSTER_SPRITES).find((candidate) => url === sheetUrl(candidate));
  if (!sheet) throw new Error(`no sheet at ${url}`);
  return Promise.resolve(new Texture({ source: new TextureSource({ width: sheet.width, height: sheet.height }) }));
};

const battle = (classic: boolean) => {
  const run = fixtureRun(fixture, { rulesVersion: CLIENT_RULES_VERSION });
  const target = watchTarget(run);
  const session = new AttackSession({ target, seed: run.replay.seed, declareWar: run.replay.declareWar });
  session.playScript(watchEvents(run), run.replay.tick);
  session.start();
  const depth = new Container();
  const heard: Effect[] = [];
  const clock = { ms: 0 };
  const layer = new AttackBattleLayer({
    session,
    yard: readYard(target.load as BaseLoadResponse),
    host: {
      depthSortedLayer: () => depth,
      centreOf: () => ({ x: 400, y: 400 }),
      setBuildingDamage: () => {},
      setConcealed: () => {},
      setAnimFrame: () => {},
    },
    overlay: new Container(),
    reducedMotion: true,
    classic,
    textures: new MonsterSheetTextures(blankSheet),
    now: () => clock.ms,
    random: () => 0.5,
    playSound: (effect) => heard.push(effect),
  });
  const frames = (count: number): void => {
    for (let step = 0; step < count && !session.ended; step += 1) {
      session.advance(1 / 60);
      clock.ms += 1000 / 60;
      layer.update();
    }
  };
  return { session, layer, heard, frames };
};

describe("the battle layer's attack sounds", { timeout: BATTLE_TIMEOUT_MS }, () => {
  for (const classic of [false, true]) {
    it(`sounds a watched battle's shots, swings and deaths (${classic ? "Classic" : "Modern"} look)`, () => {
      const { layer, heard, frames } = battle(classic);
      frames(40 * 60);
      const kinds = new Set(heard);
      // Some tower shot, some swing, some death thud.
      expect([...kinds].some((effect) => ["splash1", "snipe1", "laser", "lightningfire", "railgun1"].includes(effect))).toBe(true);
      expect([...kinds].some((effect) => effect.startsWith("hit") || effect.startsWith("ihit"))).toBe(true);
      expect([...kinds].some((effect) => effect.startsWith("monsterland"))).toBe(true);
      layer.destroy();
    });
  }

  it("sounds nothing more once skipped to the end", () => {
    const { session, layer, heard, frames } = battle(false);
    frames(10 * 60);
    session.skipToEnd();
    const before = heard.length;
    expect(before).toBeGreaterThan(0);
    frames(10_000);
    layer.update();
    expect(layer.isSettled).toBe(true);
    expect(heard).toHaveLength(before);
    layer.destroy();
  });
});
