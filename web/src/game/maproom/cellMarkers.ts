import type { Graphics } from "pixi.js";
import type { Point } from "@/game/HexGrid";
import {
  CellMarker,
  DAMAGE_COLOUR,
  OWN_COLOUR,
  SHIELD_COLOUR,
  type CellAppearance,
} from "./cellVisuals";

/**
 * The glyph vocabulary of the map, drawn as vectors.
 *
 * This file is the seam for art: every shape here is a stand-in for a sprite,
 * and swapping to an atlas means replacing these functions with frame lookups
 * against the same `CellAppearance`. Nothing else in the renderer knows what a
 * camp looks like.
 *
 * All sizes are fractions of the cell, so a glyph stays proportionate at every
 * zoom; stroke widths are divided by the zoom so an outline stays one or two
 * screen pixels rather than vanishing when the map is pulled back.
 */

export interface MarkerContext {
  cellWidth: number;
  cellHeight: number;
  zoom: number;
}

/** A polygon, flattened the way Pixi's `poly` wants it. */
export type FlatPolygon = number[];

/** Collects one cell's glyph into a per-colour bucket for batched filling. */
export const markerPolygon = (
  appearance: CellAppearance,
  centre: Point,
  context: MarkerContext,
): FlatPolygon | null => {
  const width = context.cellWidth;
  const height = context.cellHeight;

  switch (appearance.marker) {
    case CellMarker.CAMP:
    case CellMarker.CAMP_DESTROYED: {
      // A tent: a squat triangle sitting on the cell's centre line.
      const half = width * 0.15;
      const rise = height * 0.3;
      return [
        centre.x - half,
        centre.y + rise * 0.6,
        centre.x,
        centre.y - rise,
        centre.x + half,
        centre.y + rise * 0.6,
      ];
    }
    case CellMarker.YARD: {
      // A house: a square with a roof, the silhouette of a main yard.
      const half = width * 0.14;
      const eaves = height * 0.1;
      const ridge = height * 0.32;
      return [
        centre.x - half,
        centre.y + ridge * 0.7,
        centre.x - half,
        centre.y - eaves,
        centre.x,
        centre.y - ridge,
        centre.x + half,
        centre.y - eaves,
        centre.x + half,
        centre.y + ridge * 0.7,
      ];
    }
    case CellMarker.OUTPOST: {
      // A diamond, deliberately smaller than a main yard.
      const half = width * 0.11;
      const rise = height * 0.24;
      return [
        centre.x,
        centre.y - rise,
        centre.x + half,
        centre.y,
        centre.x,
        centre.y + rise,
        centre.x - half,
        centre.y,
      ];
    }
    default:
      return null;
  }
};

/**
 * Draws the per-cell decoration that cannot be colour-batched: the damage bar,
 * the destroyed cross and the ownership and shield rings.
 */
export const drawCellDecoration = (
  graphics: Graphics,
  appearance: CellAppearance,
  centre: Point,
  corners: Point[],
  context: MarkerContext,
): void => {
  const { cellWidth: width, cellHeight: height, zoom } = context;

  if (appearance.damage > 0) {
    const barWidth = width * 0.3;
    const barHeight = Math.max(height * 0.06, 1 / zoom);
    const left = centre.x - barWidth / 2;
    const top = centre.y + height * 0.28;

    graphics.rect(left, top, barWidth, barHeight);
    graphics.fill({ color: 0x000000, alpha: 0.45 });
    graphics.rect(left, top, barWidth * appearance.damage, barHeight);
    graphics.fill({ color: DAMAGE_COLOUR });
  }

  if (appearance.marker === CellMarker.CAMP_DESTROYED) {
    const arm = width * 0.1;
    graphics.moveTo(centre.x - arm, centre.y - arm);
    graphics.lineTo(centre.x + arm, centre.y + arm);
    graphics.moveTo(centre.x + arm, centre.y - arm);
    graphics.lineTo(centre.x - arm, centre.y + arm);
    graphics.stroke({ width: Math.max(2 / zoom, height * 0.03), color: DAMAGE_COLOUR });
  }

  if (appearance.shielded) {
    graphics.poly(inset(corners, centre, 0.72));
    graphics.stroke({ width: Math.max(1.5 / zoom, height * 0.02), color: SHIELD_COLOUR });
  }

  if (appearance.own) {
    graphics.poly(flatten(corners));
    graphics.stroke({ width: Math.max(2.5 / zoom, height * 0.04), color: OWN_COLOUR });
  }
};

/** Flattens a corner list into the `[x, y, x, y, ...]` Pixi expects. */
export const flatten = (points: Point[]): FlatPolygon => {
  const flat: FlatPolygon = [];
  for (const point of points) flat.push(point.x, point.y);
  return flat;
};

/** Scales a polygon towards a centre, for a ring that sits inside the hex. */
const inset = (points: Point[], centre: Point, factor: number): FlatPolygon => {
  const flat: FlatPolygon = [];
  for (const point of points) {
    flat.push(
      centre.x + (point.x - centre.x) * factor,
      centre.y + (point.y - centre.y) * factor,
    );
  }
  return flat;
};
