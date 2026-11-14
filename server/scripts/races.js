// Conflict stress test: many users on different server instances grab the
// same sticky note at the same instant. For every trial it checks:
//   1. exactly one user is granted the lock
//   2. everyone else's commits are rejected while it is held
//   3. the holder's commit is accepted and bumps the version by one
//   4. a later commit based on the old version is rejected as stale
//   5. the final note holds the holder's text, at the expected version
//
//   npm run bench:races -w server -- --from http://localhost:4100 --to http://localhost:4101
const { io } = require('socket.io-client');
const { cleanupBoard } = require('./cleanup');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const FROM = arg('from', 'http://localhost:4000');
const TO = arg('to', FROM);
const TRIALS = Number(arg('trials', 500));
const CLIENTS = Number(arg('clients', 10));
const board = `bench-races-${Date.now()}`;
// Each connection is rate limited (100 messages a second on average by
// default). Pacing the trials keeps this test under that, so it measures
// conflicts and not the limiter.
const PACE_MS = Number(arg('pace', 40));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connect = (url) =>
  new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'], reconnection: false });
    socket.once('connect_error', reject);
    socket.once('board:snapshot', () => resolve(socket));
    socket.on('connect', () => socket.emit('board:join', board));
  });
const call = (socket, event, data) =>
  new Promise((resolve, reject) =>
    socket.emit(event, data, (res) =>
      res && res.reason === 'rate_limited'
        ? reject(new Error('the server rate limited this test; raise --pace or the RATE_LIMIT_* settings'))
        : resolve(res)
    )
  );

async function main() {
  const clients = await Promise.all(Array.from({ length: CLIENTS }, (_, i) => connect(i % 2 ? TO : FROM)));
  const violations = { doubleGrant: 0, noGrant: 0, nonHolderAccepted: 0, holderRejected: 0, staleAccepted: 0, wrongFinalState: 0 };
  let contestedAttempts = 0;

  for (let t = 0; t < TRIALS; t++) {
    await sleep(PACE_MS);
    const id = `note-${t}`;
    await call(clients[0], 'note:add', { id, x: 0, y: 0, text: '', color: '#fff59d' });

    // 1. Everyone grabs the note at once.
    const grabs = await Promise.all(clients.map((c, i) => call(c, 'note:lock', { id, name: `user${i}`, color: '#000000' })));
    contestedAttempts += grabs.length;
    const winners = grabs.map((r, i) => (r.ok ? i : -1)).filter((i) => i >= 0);
    if (winners.length > 1) violations.doubleGrant++;
    if (winners.length === 0) { violations.noGrant++; continue; }
    const holder = winners[0];
    const others = clients.map((_, i) => i).filter((i) => i !== holder);

    // 2. Nobody else can commit while the lock is held.
    const sneaky = await Promise.all(others.map((i) => call(clients[i], 'note:commit', { id, baseVersion: 1, changes: { text: `user${i}` } })));
    violations.nonHolderAccepted += sneaky.filter((r) => r.ok).length;

    // 3. The holder commits.
    const text = `winner-${holder}`;
    const committed = await call(clients[holder], 'note:commit', { id, baseVersion: 1, changes: { text } });
    if (!committed.ok || committed.note.version !== 2) violations.holderRejected++;

    // 4. A commit based on the old version must be rejected as stale.
    const late = others[0];
    await call(clients[late], 'note:lock', { id, name: 'late', color: '#000000' });
    const stale = await call(clients[late], 'note:commit', { id, baseVersion: 1, changes: { text: 'stale write' } });
    if (stale.ok) violations.staleAccepted++;

    // 5. The note ends up exactly as the holder left it.
    const final = await call(clients[others[1]], 'note:lock', { id, name: 'check', color: '#000000' });
    if (!final.ok || final.note.text !== text || final.note.version !== 2) violations.wrongFinalState++;
    clients[others[1]].emit('note:unlock', { id }); // fire-and-forget: the server sends no ack
  }

  const total = Object.values(violations).reduce((a, b) => a + b, 0);
  console.log(`${TRIALS} contested trials, ${CLIENTS} users per trial across ${FROM === TO ? 'one server' : '2 servers'}`);
  console.log(`  ${contestedAttempts.toLocaleString()} simultaneous lock attempts`);
  for (const [name, count] of Object.entries(violations)) console.log(`  ${name}: ${count}`);
  console.log(total === 0 ? '  result: no conflicts leaked through' : `  result: ${total} VIOLATIONS`);

  clients.forEach((c) => c.disconnect());
  await new Promise((r) => setTimeout(r, 500)); // let background saves land before cleanup
  await cleanupBoard(board);
  if (total > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error('Race test failed:', err.message || err);
  await cleanupBoard(board).catch(() => {});
  process.exit(1);
});
