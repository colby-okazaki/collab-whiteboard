import { ARROW_PATH, OUTLINE_WIDTH, TIP, pointerCursor } from '../utils/pointerCursor';

const decode = (cursor) => decodeURIComponent(cursor.match(/data:image\/svg\+xml,([^"]*)"/)[1]);
const parse = (color) => new DOMParser().parseFromString(decode(pointerCursor(color)), 'image/svg+xml');

test('is a CSS cursor image with its hotspot at the arrow tip and the normal arrow as fallback', () => {
  expect(pointerCursor('#2563eb')).toMatch(new RegExp(`^url\\("data:image/svg\\+xml,.+"\\) ${TIP} ${TIP}, default$`));
});

test('the arrow is outlined in the given color and filled white', () => {
  const path = parse('#2563eb').querySelector('path');
  expect(path.getAttribute('stroke')).toBe('#2563eb');
  expect(path.getAttribute('fill')).toBe('#fff');
  expect(path.getAttribute('stroke-width')).toBe(String(OUTLINE_WIDTH));
});

test('different colors give different cursors', () => {
  expect(pointerCursor('#2563eb')).not.toBe(pointerCursor('#e11d48'));
});

test('is well-formed SVG with a single arrow shape', () => {
  const doc = parse('#2563eb');
  expect(doc.querySelector('parsererror')).toBeNull();
  expect(doc.querySelectorAll('path')).toHaveLength(1);
  expect(doc.querySelector('path').getAttribute('d')).toBe(ARROW_PATH);
});

test('the arrow starts at its hotspot, so a click lands where the tip points', () => {
  expect(ARROW_PATH.startsWith(`M${TIP} ${TIP}`)).toBe(true);
});

test('the arrow fits inside the cursor image, outline included', () => {
  const numbers = ARROW_PATH.match(/[\d.]+/g).map(Number);
  expect(Math.max(...numbers) + OUTLINE_WIDTH / 2).toBeLessThanOrEqual(24);
});
