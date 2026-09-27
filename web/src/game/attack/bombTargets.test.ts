import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BaseLoadResponse } from "@/api/types";
import { BOMBS, buildEngineYard, createBattle, type BombStats } from "@/game/combat/rules";
import { bombCandidatesOf, bombHits } from "./bombTargets";

/**
 * The buildings a bomb is shown to hit are the buildings the engine hits
 * (#88), and the health each is shown to lose is what the engine takes (#87).
 * Checked by landing real bombs in real battles on the sandbox yard — 575
 * buildings, 400 of them wall blocks, traps and decorations among them.
 */

const SANDBOX = fileURLToPath(
  new URL("../../../test/fixtures/baseload-sandbox-yard.json", import.meta.url),
);
const load = JSON.parse(readFileSync(SANDBOX, "utf8")) as BaseLoadResponse;

const bomb = (id: string): BombStats => {
  const found = BOMBS.find((one) => one.id === id);
  if (!found) throw new Error(id);
  return found;
};

/** What a bomb at `point` actually did, building by building, in a fresh battle. */
const engineDamage = (spec: BombStats, point: { x: number; y: number }): Map<number, number> => {
  const input = {
    buildingdata: load.buildingdata ?? {},
    buildinghealthdata: load.buildinghealthdata ?? null,
  };
  const before = new Map(buildEngineYard(input).buildings.map((b) => [b.id, b.hp]));
  const battle = createBattle(buildEngineYard(input), { seed: 7 });
  battle.apply({ kind: "bomb", t: 0, x: point.x, y: point.y, id: spec.id });
  const lost = new Map<number, number>();
  for (const [id, hp] of before) {
    const after = battle.state().health[String(id)] ?? hp;
    if (after < hp) lost.set(id, hp - after);
  }
  return lost;
};

/** A spread of landing points: every seventh building's anchor, nudged off it. */
const points = (): Array<{ x: number; y: number }> => {
  const raw = Object.values(load.buildingdata ?? {}) as Array<{ X: number; Y: number }>;
  return raw.filter((_, index) => index % 7 === 0).map((b) => ({ x: b.X + 17, y: b.Y - 9 }));
};

describe("bombHits", () => {
  const candidates = bombCandidatesOf(load);

  it("leaves out the classes a bomb passes over", () => {
    expect(candidates.length).toBeGreaterThan(400);
    expect(candidates.some((c) => c.kind === "trap" || c.kind === "decoration")).toBe(false);
    expect(candidates.some((c) => c.kind === "wall")).toBe(true);
  });

  for (const id of ["tw0", "pb1", "pb3"]) {
    it(`names exactly the buildings the engine damages, and by how much (${id})`, () => {
      const spec = bomb(id);
      let hitSomething = 0;
      for (const point of points()) {
        const lost = engineDamage(spec, point);
        const hits = bombHits(spec, point, candidates);
        expect(hits.map((hit) => hit.id).sort((a, b) => a - b)).toEqual(
          [...lost.keys()].sort((a, b) => a - b),
        );
        for (const hit of hits) {
          // The engine's health map is `int(health)`; a hit capped at what the
          // building had left takes less than the full share.
          expect(lost.get(hit.id)).toBeLessThanOrEqual(Math.ceil(hit.damage));
          expect(lost.get(hit.id)).toBeGreaterThanOrEqual(0);
        }
        if (hits.length > 0) hitSomething += 1;
      }
      expect(hitSomething).toBeGreaterThan(5);
    });
  }

  it("skips a building the battle has flattened", () => {
    const spec = bomb("pb3");
    const point = points()[3]!;
    const hits = bombHits(spec, point, candidates);
    expect(hits.length).toBeGreaterThan(0);
    const first = hits[0]!.id;
    const after = bombHits(spec, point, candidates, [first]);
    expect(after.map((hit) => hit.id)).not.toContain(first);
    expect(after).toHaveLength(hits.length - 1);
  });

  it("hits no building with a putty bomb", () => {
    expect(bombHits(bomb("pu3"), points()[0]!, candidates)).toEqual([]);
  });

  it("reads nothing before the attack has loaded", () => {
    expect(bombCandidatesOf(null)).toEqual([]);
  });
});
