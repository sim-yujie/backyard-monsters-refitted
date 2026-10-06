import { Assets, type Texture } from "pixi.js";

/**
 * MOCK-UP ONLY (branch `mock/hexcell-styles`): building art borrowed from the
 * Yard screen for the hex-cell style trial, rather than new art (the owner's
 * instruction was to reuse in-game sprites, not generate any).
 *
 * Same files the Yard renders from `server/public/assets/buildings/...`,
 * served under `/assets/` (see `buildingArt.ts`). A main yard wears the Town
 * Hall; an outpost wears the Cannon Tower, a visibly smaller defensive
 * structure, so the two read apart by building alone.
 */
const FILES = {
  yard: "/assets/buildings/townhall/top.3.png",
  outpost: "/assets/buildings/cannontower/top.3.png",
} as const;

export type MockBuildingKind = keyof typeof FILES;

export class MockBuildingArt {
  private readonly textures = new Map<MockBuildingKind, Texture>();
  private pending: Promise<boolean> | null = null;

  get ready(): boolean {
    return this.textures.size > 0;
  }

  textureFor(kind: MockBuildingKind): Texture | null {
    return this.textures.get(kind) ?? null;
  }

  load(): Promise<boolean> {
    this.pending ??= this.loadOnce();
    return this.pending;
  }

  private async loadOnce(): Promise<boolean> {
    await Promise.all(
      (Object.entries(FILES) as [MockBuildingKind, string][]).map(async ([kind, url]) => {
        try {
          this.textures.set(kind, await Assets.load<Texture>(url));
        } catch (caught) {
          console.warn(`Mock building art ${url} did not load.`, caught);
        }
      }),
    );
    return this.textures.size > 0;
  }
}

/** One instance shared by every chunk, loaded once when a style needs it. */
export const mockBuildingArt = new MockBuildingArt();
