// Each person on a board gets their own color, shown around their cursor and
// on notes they are editing. The first colors are picked to be easy to tell
// apart; if a board has more people than that, further colors are spread
// around the colour wheel so they still differ.
const PALETTE = [
  '#e11d48', // red
  '#2563eb', // blue
  '#16a34a', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#db2777', // pink
  '#65a30d', // lime
  '#ea580c', // orange
  '#4f46e5', // indigo
  '#0d9488', // teal
  '#a16207', // brown
];

const GOLDEN_ANGLE = 137.508;

// Hue in degrees, saturation and lightness in percent.
function hslToHex(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const v = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

// The first palette color nobody has, or a new one once the palette is used up.
function pickColor(taken) {
  const free = PALETTE.find((c) => !taken.has(c));
  if (free) return free;
  for (let i = taken.size; ; i++) {
    const generated = hslToHex((i * GOLDEN_ANGLE) % 360, 70, 42);
    if (!taken.has(generated)) return generated;
  }
}

module.exports = { PALETTE, pickColor, hslToHex };
