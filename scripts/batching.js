// Measures how much network traffic the client's batching and throttling
// save, using the real utilities from client/src/utils (not copies).
//
// A mouse or trackpad reports at 60-120 events a second. Without any
// batching every event would be its own socket message; with it, points are
// sent every 40ms and cursor updates at most every 50ms.
//
//   npm run bench:batching
const SECONDS = 4;

const json = (value) => JSON.stringify(value).length;

async function simulate(hz, { createBatcher, throttle }) {
  const stroke = { points: { raw: { messages: 0, bytes: 0 }, sent: { messages: 0, bytes: 0 } }, cursor: { raw: { messages: 0, bytes: 0 }, sent: { messages: 0, bytes: 0 } } };
  const add = (bucket, msg) => { bucket.messages++; bucket.bytes += json(msg); };

  const batcher = createBatcher((points) => add(stroke.points.sent, { id: 'stroke-id', points }), 40);
  const sendCursor = throttle((x, y) => add(stroke.cursor.sent, { x, y, name: 'Guest 123', color: '#2563eb' }), 50);

  let n = 0;
  const timer = setInterval(() => {
    const x = 100 + (n % 600) + Math.random();
    const y = 200 + Math.sin(n / 10) * 80;
    n++;
    add(stroke.points.raw, { id: 'stroke-id', points: [x, y] });
    batcher.push(x, y);
    add(stroke.cursor.raw, { x, y, name: 'Guest 123', color: '#2563eb' });
    sendCursor(x, y);
  }, 1000 / hz);

  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(timer);
  batcher.flush();

  return { hz, events: n, stroke };
}

const cut = (raw, sent) => `${raw.messages} -> ${sent.messages} messages (${((1 - sent.messages / raw.messages) * 100).toFixed(0)}% fewer), ${(raw.bytes / 1024).toFixed(1)} -> ${(sent.bytes / 1024).toFixed(1)} KB (${((1 - sent.bytes / raw.bytes) * 100).toFixed(0)}% less)`;

async function main() {
  const utils = {
    ...(await import('../client/src/utils/batcher.js')),
    ...(await import('../client/src/utils/throttle.js')),
  };
  console.log(`Simulated ${SECONDS}s of continuous drawing and cursor movement:\n`);
  for (const hz of [60, 120]) {
    const r = await simulate(hz, utils);
    console.log(`${hz} Hz input (${r.events} events)`);
    console.log(`  stroke points:  ${cut(r.stroke.points.raw, r.stroke.points.sent)}`);
    console.log(`  cursor updates: ${cut(r.stroke.cursor.raw, r.stroke.cursor.sent)}`);
  }
  console.log('\nBytes count the JSON payload only; socket framing would add to the unbatched side.');
}

main();
