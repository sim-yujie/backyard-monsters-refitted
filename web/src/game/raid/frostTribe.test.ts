import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TRIBE_COLOURS } from "@/game/maproom/cellVisuals";
import { tribePictureUrl } from "@/game/maproom/tribeAvatars";
import { tribeGoalPicture } from "@/ui/attack/RepeatBar";
import { raidTribe } from "./raidText";

const web = (src: string): string => fileURLToPath(new URL(`../../../public${src.replace(/^.*?\/tribes\//, "/tribes/")}`, import.meta.url));
const server = (src: string): string =>
  fileURLToPath(new URL(`../../../../server/public${src.replace(/^.*?\/assets\//, "/assets/")}`, import.meta.url));

describe("the frost tribe (beta 10)", () => {
  it("has its avatar, map colour and Classic splash and icon on disk", () => {
    const avatar = tribePictureUrl("Frost");
    expect(avatar).toContain("frost-256.png");
    expect(existsSync(web(avatar ?? ""))).toBe(true);
    expect(TRIBE_COLOURS["Frost"]).toBeDefined();
    expect(raidTribe("Frost").name).toBe("Frost");
    expect(existsSync(server(raidTribe("Frost").splash))).toBe(true);
    expect(existsSync(server(tribeGoalPicture("Frost", true) ?? ""))).toBe(true);
    expect(existsSync(server("/assets/monsters/tribe_frost_50.v2.jpg"))).toBe(true);
  });
});
