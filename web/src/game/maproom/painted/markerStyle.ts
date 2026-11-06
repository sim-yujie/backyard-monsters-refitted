import type { HexShape } from "@/game/HexGrid";

/**
 * How a player's name tag and level star look (plan step 8, "markers on the painted map").
 *
 * Today's tile map keeps its slim relation-coloured plates. On the painted map the tags follow
 * mock-up B: one cream parchment tag with dark bold text for every player, larger so the name
 * reads on the busy painted ground, and a larger level star. Who the player is to you is shown
 * by the glowing border round their land (`borders.ts`) instead of the tag's colour.
 *
 * The pointy-top painted cell is twice as tall as the flat one the marker sizes were made for,
 * so the tag grows more there; on a flat painted map it grows only a little, to stay inside
 * the hex's narrow lower half.
 */
export interface TagStyle {
  /** Multiplies the tag's text size, height and padding. */
  scale: number;
  /** Multiplies the level star and its number. */
  starScale: number;
  /** The plate's tint, or null for today's relation colour. */
  plate: number | null;
  /** The text colour, or null for today's colour by relation. */
  text: number | null;
  /** Opacity of the plate (today: own 1, others a little see-through). */
  plateAlpha: number | null;
}

/** Mock-up B's tag: light parchment with near-black brown text. */
export const PAINTED_TAG_COLOUR = 0xf6e7b8;
export const PAINTED_TAG_TEXT = 0x2e2210;

export const TILE_TAG_STYLE: TagStyle = { scale: 1, starScale: 1, plate: null, text: null, plateAlpha: null };

export const tagStyle = (painted: boolean, shape: HexShape): TagStyle =>
  painted
    ? {
        scale: shape === "pointy" ? 1.55 : 1.15,
        starScale: shape === "pointy" ? 1.45 : 1.15,
        plate: PAINTED_TAG_COLOUR,
        text: PAINTED_TAG_TEXT,
        plateAlpha: 1,
      }
    : TILE_TAG_STYLE;
