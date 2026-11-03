// Load test: many users connected to one board, some of them moving their
// cursor at 20 updates a second (the rate the client sends). Measures how
// many updates reach everyone else and how long they take.
//
//   npm run bench:load -w server -- --users 100 --active 20
//   npm run bench:load -w server -- --servers http://localhost:4100,http://localhost:4101
//
// With several --servers, users are spread across them round-robin, so
// deliveries also cross the Redis hop between instances.
const { io } = require('socket.io-client');
const { summarize } = require('./stats');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const SERVERS = arg('servers', 'http://localhost:4000').split(',');
const USERS = Number(arg('users', 100));
const ACTIVE = Math.min(USERS, Number(arg('active', 20)));
const SECONDS = Number(arg('seconds', 10));
const RATE_HZ = 20;
const board = `bench-load-${Date.now()}`;

const t0 = process.hrtime.bigint();
const nowMs = () => Number(process.hrtime.bigint() - t0) / 1e6;

const connect = (url) =>
  new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'], reconnection: false });
    socket.once('connect_error', reject);
    socket.once('board:snapshot', () => resolve(socket));
    socket.on('connect', () => socket.emit('board:join', board));
  });

async function main() {
  const sockets = await Promise.all(Array.from({ length: USERS }, (_, i) => connect(SERVERS[i % SERVERS.length])));

  const latencies = [];
  for (const socket of sockets) {
    // The send time travels in x, so every receiver can compute its own delay.
    socket.on('cursor:move', ({ x }) => latencies.push(nowMs() - x));
  }

  let sent = 0;
  const timers = sockets.slice(0, ACTIVE).map((socket, i) =>
    setInterval(() => {
      sent++;
      socket.emit('cursor:move', { x: nowMs(), y: i, name: 'bench', color: '#000000' });
    }, 1000 / RATE_HZ)
  );

  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  timers.forEach(clearInterval);
  await new Promise((r) => setTimeout(r, 2000)); // let in-flight messages arrive

  const expected = sent * (USERS - 1);
  const s = summarize(latencies);
  const ms = (n) => `${n.toFixed(1)} ms`;
  const where = SERVERS.length > 1 ? `${SERVERS.length} servers` : 'one server';
  console.log(`${USERS} users (${ACTIVE} moving at ${RATE_HZ}/s) on ${where}, ${SECONDS}s`);
  console.log(`  delivered ${latencies.length.toLocaleString()} of ${expected.toLocaleString()} (${((latencies.length / expected) * 100).toFixed(2)}%), ${Math.round(latencies.length / SECONDS).toLocaleString()} deliveries/s`);
  console.log(`  latency  p50 ${ms(s.p50)}   p95 ${ms(s.p95)}   p99 ${ms(s.p99)}   max ${ms(s.max)}`);

  sockets.forEach((socket) => socket.disconnect());
  await require('./cleanup').cleanupBoard(board);
  if (latencies.length < expected) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Load test failed:', err.message || err);
  process.exit(1);
});
