import { ringCursor } from '../utils/ringCursor';

const decode = (cursor) => decodeURIComponent(cursor.match(/data:image\/svg\+xml,([^"]*)"/)[1]);

test('is a CSS cursor image with its hotspot in the middle and a fallback', () => {
  expect(ringCursor('#2563eb')).toMatch(/^url\("data:image\/svg\+xml,.+"\) 16 16, crosshair$/);
});

test('contains a ring in the given color', () => {
  expect(decode(ringCursor('#2563eb'))).toContain('stroke="#2563eb"');
});

test('different colors give different cursors', () => {
  expect(ringCursor('#2563eb')).not.toBe(ringCursor('#e11d48'));
});

test('has a white halo, so it shows on dark strokes too', () => {
  expect(decode(ringCursor('#2563eb'))).toContain('stroke="#fff"');
});

test('is well-formed SVG', () => {
  const doc = new DOMParser().parseFromString(decode(ringCursor('#2563eb')), 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  expect(doc.querySelectorAll('circle')).toHaveLength(3);
});
