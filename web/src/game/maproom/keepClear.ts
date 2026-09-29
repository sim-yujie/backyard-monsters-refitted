/**
 * How far to pan the map so a selected cell is not under its own cell panel
 * (issue #153). On a phone the panel is a sheet over the bottom of the map
 * (#151), so a cell tapped low down was hidden by the very panel describing
 * it: it moves up into the band between the HUD and the sheet. Beside the
 * desktop's side panel it moves left of it. Pure: screen pixels in and out.
 */

export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface KeepClearInput {
  /** The cell's centre on screen. */
  readonly point: { readonly x: number; readonly y: number };
  /** Half the cell's width and height on screen, at the current zoom. */
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** The open cell panel. */
  readonly panel: ScreenRect;
  readonly viewportWidth: number;
  /** The HUD's bottom edge: nothing shows above it. */
  readonly hudBottom: number;
}

/** A panel this much of the screen's width or wider is the phone's sheet. */
const SHEET_WIDTH = 0.8;

/**
 * The screen-space pan (as `Camera.panByScreen` takes it) that brings the
 * cell clear of the panel, or null when the panel does not cover it.
 */
export const panClearOfPanel = ({
  point,
  halfWidth,
  halfHeight,
  panel,
  viewportWidth,
  hudBottom,
}: KeepClearInput): { dx: number; dy: number } | null => {
  const covered =
    point.x + halfWidth > panel.left &&
    point.x - halfWidth < panel.right &&
    point.y + halfHeight > panel.top &&
    point.y - halfHeight < panel.bottom;
  if (!covered) return null;

  if (panel.right - panel.left >= viewportWidth * SHEET_WIDTH) {
    return { dx: 0, dy: (hudBottom + panel.top) / 2 - point.y };
  }
  return { dx: panel.left / 2 - point.x, dy: 0 };
};
