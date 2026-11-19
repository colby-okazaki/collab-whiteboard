// The pointer: an ordinary arrow with white fill and an outline in the
// person's color. The same shape is used for your own mouse pointer (as a
// CSS cursor image) and for everyone else's cursor on the board, so what you
// see for yourself is what others see for you.

// Path in a 24 x 24 box; the tip of the arrow is at (TIP, TIP).
export const ARROW_PATH = 'M2 2 L2 19 L6.2 15 L9.3 22 L12.2 20.8 L9.2 14 L15 14 Z';
export const TIP = 2;
export const OUTLINE_WIDTH = 2;
const SIZE = 24;

// A CSS cursor value. The hotspot is the arrow's tip, so clicks land where
// the point is, and the default arrow is the fallback.
export function pointerCursor(color) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<path d="${ARROW_PATH}" fill="#fff" stroke="${color}" stroke-width="${OUTLINE_WIDTH}" stroke-linejoin="round"/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${TIP} ${TIP}, default`;
}
