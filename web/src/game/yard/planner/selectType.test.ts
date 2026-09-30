import { describe, expect, it } from "vitest";
import type { PlanNode } from "./placement";
import { sameTypeIds } from "./selectType";

const node = (id: number, type: number): PlanNode => ({ id, type }) as PlanNode;

const yard = [node(1, 20), node(2, 20), node(3, 20), node(4, 21)];

describe("sameTypeIds", () => {
  it("offers every building of the selected one's type", () => {
    expect(sameTypeIds([node(1, 20)], yard)).toEqual({ type: 20, ids: [1, 2, 3] });
  });

  it("offers the rest when part of the type is already selected", () => {
    expect(sameTypeIds([node(1, 20), node(3, 20)], yard)).toEqual({ type: 20, ids: [1, 2, 3] });
  });

  it("offers nothing when every one of them is already selected", () => {
    expect(sameTypeIds([node(4, 21)], yard)).toBeNull();
    expect(sameTypeIds([node(1, 20), node(2, 20), node(3, 20)], yard)).toBeNull();
  });

  it("offers nothing for an empty or a mixed selection", () => {
    expect(sameTypeIds([], yard)).toBeNull();
    expect(sameTypeIds([node(1, 20), node(4, 21)], yard)).toBeNull();
  });
});
