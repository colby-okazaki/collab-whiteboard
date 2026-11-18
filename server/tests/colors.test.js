const { PALETTE, pickColor, hslToHex } = require('../src/colors');

test('the palette colors are all different valid hex colors', () => {
  expect(new Set(PALETTE).size).toBe(PALETTE.length);
  PALETTE.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/));
});

test('the first person gets the first color', () => {
  expect(pickColor(new Set())).toBe(PALETTE[0]);
});

test('skips colors that are taken', () => {
  expect(pickColor(new Set([PALETTE[0], PALETTE[2]]))).toBe(PALETTE[1]);
});

test('reuses a color that was freed', () => {
  const taken = new Set(PALETTE);
  taken.delete(PALETTE[3]);
  expect(pickColor(taken)).toBe(PALETTE[3]);
});

test('hands out only different colors, well beyond the size of the palette', () => {
  const taken = new Set();
  for (let i = 0; i < 100; i++) taken.add(pickColor(taken));
  expect(taken.size).toBe(100);
  taken.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/));
});

test('colors beyond the palette are not copies of it', () => {
  const taken = new Set(PALETTE);
  expect(PALETTE).not.toContain(pickColor(taken));
});

describe('hslToHex', () => {
  test.each([
    [0, 100, 50, '#ff0000'],
    [120, 100, 50, '#00ff00'],
    [240, 100, 50, '#0000ff'],
    [0, 0, 100, '#ffffff'],
    [0, 0, 0, '#000000'],
  ])('hsl(%i, %i%%, %i%%) is %s', (h, s, l, hex) => {
    expect(hslToHex(h, s, l)).toBe(hex);
  });
});
