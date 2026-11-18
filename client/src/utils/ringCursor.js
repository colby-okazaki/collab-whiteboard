// The mouse pointer over the board: a ring in your color with a dot in the
// middle, the same look other people see for your cursor. A white halo keeps
// it visible on any color. Built as an SVG used as a CSS cursor image; the
// hotspot is the centre, and crosshair is the fallback.
const SIZE = 32;
const CENTER = SIZE / 2;

export function ringCursor(color) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<circle cx="${CENTER}" cy="${CENTER}" r="11" fill="none" stroke="#fff" stroke-width="5"/>` +
    `<circle cx="${CENTER}" cy="${CENTER}" r="11" fill="none" stroke="${color}" stroke-width="3"/>` +
    `<circle cx="${CENTER}" cy="${CENTER}" r="2.5" fill="${color}" stroke="#fff" stroke-width="1"/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${CENTER} ${CENTER}, crosshair`;
}
