// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Container, Texture, type Sprite } from "pixi.js";
import { creepZIndex, MonsterSheetTextures } from "@/game/attack/AttackBattleLayer";
import { anchorOffset, spriteFor } from "@/game/attack/monsterSprites";
import { StagedRaidLayer } from "./StagedRaidLayer";
import { RAID_COUNT, RAID_MONSTER } from "./stagedRaid";

/** Bob's staged raid stands its oozes among the buildings, as a real attack does (#272). */

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("StagedRaidLayer", () => {
  it("sorts each ooze among the buildings by the attack screen's creep key, and takes it out after", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    vi.spyOn(MonsterSheetTextures.prototype, "frame").mockReturnValue(Texture.WHITE);
    const among = new Set<Container>();
    const host = {
      root: new Container(),
      yardToWorld: (x: number, y: number) => ({ x: x + 2000, y: y + 1000 }),
      standAmongBuildings: (child: Container) => void among.add(child),
      leaveBuildings: (child: Container) => void among.delete(child),
    };
    const raid = new StagedRaidLayer(host, { x: 0, y: 0 }, { x: -300, y: 0 }, () => {});
    raid.start();
    vi.advanceTimersByTime(200);

    const oozes = [...among] as Sprite[];
    expect(oozes).toHaveLength(RAID_COUNT);
    const anchor = anchorOffset(spriteFor(RAID_MONSTER)!);
    for (const ooze of oozes) {
      // Not in a layer of the raid's own over every building.
      expect(ooze.parent).toBeNull();
      const ground = { x: ooze.position.x - anchor.x, y: ooze.position.y - anchor.y };
      // The key of its own ground point, give or take the tie-break id.
      const key = creepZIndex(ground.x, ground.y, 0);
      expect(ooze.zIndex).toBeGreaterThanOrEqual(key);
      expect(ooze.zIndex).toBeLessThan(key + 8 * 1000);
    }

    raid.destroy();
    expect(among.size).toBe(0);
  });
});
