import { afterEach, describe, expect, it } from "vitest";
import { INFERNO_YARD, consumeOwnYardTarget } from "@/game/yard/ownYards";
import { consumeYardIntent } from "@/game/yard/yardIntent";
import { backToInferno } from "./tribeReturn";

/** The way out of a Moloch tribe attack (WP 2.10): the Inferno yard, and its map when asked. */
describe("backToInferno", () => {
  afterEach(() => {
    consumeOwnYardTarget();
    consumeYardIntent();
  });

  it("opens the Inferno yard with its map for the map", () => {
    backToInferno(true);
    expect(consumeOwnYardTarget()).toEqual(INFERNO_YARD);
    expect(consumeYardIntent()).toEqual({ kind: "infernoMap" });
  });

  it("opens the Inferno yard alone for home", () => {
    backToInferno(false);
    expect(consumeOwnYardTarget()).toEqual(INFERNO_YARD);
    expect(consumeYardIntent()).toBeNull();
  });
});
