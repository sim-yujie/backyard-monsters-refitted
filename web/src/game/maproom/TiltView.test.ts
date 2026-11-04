// @vitest-environment jsdom
import { Container, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { mapChanged } from "./TiltView";

/**
 * Redraw on change (MR2 look plan step 4): the tilted picture is redrawn only
 * when something inside the map changed, read from Pixi's own render group
 * lists, which Pixi empties as it draws.
 */

type Lists = {
  structureDidChange: boolean;
  childrenToUpdate: Record<string, { index: number; list: unknown[] }>;
  childrenRenderablesToUpdate: { index: number; list: unknown[] };
};

/** What Pixi leaves behind after drawing the group: every list empty, every flag down. */
const drawn = (root: Container): void => {
  const settle = (node: Container): void => {
    const flags = node as unknown as { didChange: boolean; didViewUpdate: boolean };
    flags.didChange = false;
    flags.didViewUpdate = false;
    node.children.forEach(settle);
  };
  settle(root);
  const group = (root as unknown as { renderGroup: Lists }).renderGroup;
  group.structureDidChange = false;
  for (const depth in group.childrenToUpdate) group.childrenToUpdate[depth]!.index = 0;
  group.childrenRenderablesToUpdate.index = 0;
};

const map = (): { root: Container; child: Container; shape: Graphics } => {
  const root = new Container();
  const child = new Container();
  const shape = new Graphics();
  child.addChild(shape);
  root.addChild(child);
  root.enableRenderGroup();
  drawn(root);
  return { root, child, shape };
};

describe("mapChanged", () => {
  it("counts a map never drawn on its own as changed", () => {
    expect(mapChanged(new Container())).toBe(true);
  });

  it("is quiet once the map is drawn and nothing moved", () => {
    expect(mapChanged(map().root)).toBe(false);
  });

  it("sees a child moved, hidden or added", () => {
    const moved = map();
    moved.child.position.set(10, 0);
    expect(mapChanged(moved.root)).toBe(true);

    const hidden = map();
    hidden.child.visible = false;
    expect(mapChanged(hidden.root)).toBe(true);

    const added = map();
    added.child.addChild(new Container());
    expect(mapChanged(added.root)).toBe(true);
  });

  it("sees a graphic redrawn", () => {
    const { root, shape } = map();
    shape.rect(0, 0, 10, 10).fill(0xffffff);
    expect(mapChanged(root)).toBe(true);
  });
});
