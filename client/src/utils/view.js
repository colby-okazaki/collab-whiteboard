// The visible part of the board: where its origin sits on screen (x, y) and
// how magnified it is. A board point p appears on screen at
// view.x + p.x * scale, and the maths below keeps that relationship.
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5;
export const INITIAL_VIEW = { x: 0, y: 0, scale: 1 };

const clamp = (scale) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

// Zooms to `scale`, keeping the board point under `anchor` (a screen
// position, e.g. the mouse) exactly where it is.
export function zoomAt(view, scale, anchor) {
  const next = clamp(scale);
  const ratio = next / view.scale;
  return {
    scale: next,
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
  };
}

// How much one wheel or pinch tick magnifies; smooth in both directions.
export const wheelFactor = (deltaY) => Math.exp(-deltaY * 0.01);

export const panBy = (view, dx, dy) => ({ ...view, x: view.x + dx, y: view.y + dy });

export const screenToBoard = (view, point) => ({
  x: (point.x - view.x) / view.scale,
  y: (point.y - view.y) / view.scale,
});

export const boardToScreen = (view, point) => ({
  x: view.x + point.x * view.scale,
  y: view.y + point.y * view.scale,
});
