import { describe, expect, it } from "vitest";
import { Container, Texture, type Sprite } from "pixi.js";
import { SHELL_SHEET_URL, ShellSprites, shellCell } from "./spurtzShell";

describe("shellCell", () => {
  it("takes one of 32 headings from the whole degrees, a negative one turned positive", () => {
    expect(shellCell(0, 0).column).toBe(0);
    expect(shellCell(11.9, 0).column).toBe(0);
    expect(shellCell(12, 0).column).toBe(1);
    expect(shellCell(-0.5, 0).column).toBe(0);
    expect(shellCell(-90, 0).column).toBe(24);
    expect(shellCell(-1, 0).column).toBe(31);
    expect(shellCell(179.9, 0).column).toBe(15);
  });

  it("swaps between rows 1 and 2 every 8 frames", () => {
    expect([0, 7, 8, 15, 16].map((frame) => shellCell(0, frame).row)).toEqual([1, 1, 2, 2, 1]);
  });
});

describe("ShellSprites", () => {
  const sheet = () => {
    let resolve: (texture: Texture) => void = () => {};
    const asked: string[] = [];
    const load = (url: string) => {
      asked.push(url);
      return new Promise<Texture>((done) => {
        resolve = done;
      });
    };
    return { load, asked, arrive: () => resolve(Texture.WHITE) };
  };

  it("draws nothing until the sheet is in, then one sprite a shell at its point and scale", async () => {
    const layer = new Container();
    const { load, asked, arrive } = sheet();
    const shells = new ShellSprites(() => layer, load);
    const shell = {};

    expect(shells.draw(shell, 10, 20, 45, 0, 0.5)).toBe(false);
    expect(asked).toEqual([SHELL_SHEET_URL]);
    arrive();
    await Promise.resolve();

    expect(shells.draw(shell, 10, 20, 45, 0, 0.5)).toBe(true);
    expect(shells.draw(shell, 12, 24, 45, 1, 0.5)).toBe(true);
    expect(layer.children).toHaveLength(1);
    const sprite = layer.children[0] as Sprite;
    expect([sprite.x, sprite.y, sprite.scale.x]).toEqual([12, 24, 0.5]);
    expect([sprite.texture.frame.x, sprite.texture.frame.y]).toEqual([4 * 34, 27]);
    shells.destroy();
  });

  it("takes away a shell that was not drawn since the last sweep", async () => {
    const layer = new Container();
    const { load, arrive } = sheet();
    const shells = new ShellSprites(() => layer, load);
    shells.preload();
    arrive();
    await Promise.resolve();
    const first = {};
    const second = {};
    shells.draw(first, 0, 0, 0, 0, 1);
    shells.draw(second, 0, 0, 0, 0, 1);
    shells.sweep();
    expect(layer.children).toHaveLength(2);

    shells.draw(second, 0, 0, 0, 0, 1);
    shells.sweep();
    expect(layer.children).toHaveLength(1);
    shells.sweep();
    expect(layer.children).toHaveLength(0);
  });
});
