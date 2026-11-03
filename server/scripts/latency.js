// Measures real-time sync latency: how long a message takes to travel from
// one connected user, through the server, to another user.
//
//   npm run bench -w server
//   npm run bench -w server -- --from http://localhost:4000 --to http://localhost:4101
//
// With different --from and --to servers (sharing Redis), this measures the
// cross-instance path. Messages are cursor updates on a throwaway board, so
// nothing is saved.
const { io } = require('socket.io-client');
const { summarize } = require('./stats');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const FROM = arg('from', 'http://localhost:4000');
const TO = arg('to', FROM);
const COUNT = Number(arg('count', 500));
const INTERVAL_MS = Number(arg('interval', 20));
const board = `bench-${Date.now()}`;

const connect = (url) =>
  new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'] });
    socket.once('connect_error', reject);
    socket.once('board:snapshot', () => resolve(socket));
    socket.emit('board:join', board);
  });

async function main() {
  const [sender, receiver] = await Promise.all([connect(FROM), connect(TO)]);
  const sentAt = new Map();
  const latencies = [];

  const done = new Promise((resolve) => {
    receiver.on('cursor:move', ({ x: seq }) => {
      const start = sentAt.get(seq);
      if (start === undefined) return;
      latencies.push(Number(process.hrtime.bigint() - start) / 1e6);
      if (latencies.length === COUNT) resolve();
    });
  });

  // Warm up the connections so the first messages don't skew results.
  for (let i = 0; i < 20; i++) sender.emit('cursor:move', { x: -1, y: 0, name: 'bench', color: '#000' });
  await new Promise((r) => setTimeout(r, 300));

  for (let seq = 0; seq < COUNT; seq++) {
    sentAt.set(seq, process.hrtime.bigint());
    sender.emit('cursor:move', { x: seq, y: 0, name: 'bench', color: '#000' });
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }

  await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]);
  sender.disconnect();
  receiver.disconnect();

  const s = summarize(latencies);
  const fmt = (n) => `${n.toFixed(2)} ms`;
  console.log(`${FROM === TO ? 'Same server' : `${FROM} -> ${TO}`}: ${s.count}/${COUNT} messages delivered`);
  console.log(`  min ${fmt(s.min)}   p50 ${fmt(s.p50)}   p95 ${fmt(s.p95)}   p99 ${fmt(s.p99)}   max ${fmt(s.max)}`);
  if (s.count < COUNT) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Benchmark failed:', err.message || err);
  process.exit(1);
});
