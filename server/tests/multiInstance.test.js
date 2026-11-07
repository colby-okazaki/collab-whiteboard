// Two server instances sharing Redis, with users connected to different
// instances. Proves broadcasts and conflict resolution work across them.
// Start Redis with `npm run db:up`; skipped when REDIS_URL is not set.
const Redis = require('ioredis');
const { io: connect } = require('socket.io-client');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createApp } = require('../src/app');
const { createPersistence } = require('../src/db/persistence');
const { RedisBoardStore } = require('../src/store/redisStore');

const url = process.env.REDIS_URL && `${process.env.REDIS_URL.replace(/\/\d+$/, '')}/14`;
const describeRedis = url ? describe : describe.skip;

describeRedis('multiple server instances', () => {
  const instances = [];
  const clients = [];

  async function startInstance() {
    const pub = new Redis(url);
    const sub = pub.duplicate();
    const store = new RedisBoardStore(url);
    const { server, io } = createApp({
      store,
      db: createPersistence(undefined),
      clientOrigin: '*',
      adapter: createAdapter(pub, sub),
    });
    await new Promise((resolve) => server.listen(0, resolve));
    instances.push({ io, store, pub, sub });
    return `http://localhost:${server.address().port}`;
  }

  // Joins a board and resolves once the snapshot arrives.
  function join(serverUrl, boardId) {
    const socket = connect(serverUrl, { transports: ['websocket'] });
    clients.push(socket);
    return new Promise((resolve) => {
      socket.once('board:snapshot', (snap) => resolve({ socket, snap }));
      socket.emit('board:join', boardId);
    });
  }

  const call = (socket, event, data) => new Promise((resolve) => socket.emit(event, data, resolve));
  const next = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
  // Broadcasts relayed through Redis can arrive after a direct ack, so wait
  // for the specific event rather than whichever comes next.
  const waitFor = (socket, event, match) =>
    new Promise((resolve) => {
      const handler = (data) => {
        if (!match(data)) return;
        socket.off(event, handler);
        resolve(data);
      };
      socket.on(event, handler);
    });

  let a;
  let b;
  beforeAll(async () => {
    const admin = new Redis(url);
    await admin.flushdb();
    await admin.quit();
    [a, b] = await Promise.all([startInstance(), startInstance()]);
  });

  afterAll(async () => {
    clients.forEach((c) => c.disconnect());
    for (const { io, store, pub, sub } of instances) {
      await new Promise((resolve) => io.close(resolve));
      await store.close();
      pub.disconnect();
      sub.disconnect();
    }
  });

  test('a stroke drawn on one instance streams to a user on the other', async () => {
    const alice = await join(a, 'strokes');
    const bob = await join(b, 'strokes');

    const started = next(bob.socket, 'stroke:start');
    alice.socket.emit('stroke:start', { id: 's1', tool: 'pen', color: '#000', points: [0, 0] });
    expect((await started).id).toBe('s1');

    const streamed = next(bob.socket, 'stroke:points');
    alice.socket.emit('stroke:points', { id: 's1', points: [5, 5] });
    expect(await streamed).toEqual({ id: 's1', points: [5, 5] });
  });

  test('a user joining a third instance sees the shared board', async () => {
    const c = await startInstance();
    const { snap } = await join(c, 'strokes');
    expect(snap.strokes).toEqual([{ id: 's1', tool: 'pen', color: '#000', points: [0, 0, 5, 5] }]);
  });

  test('a note lock held on one instance blocks a user on the other', async () => {
    const alice = await join(a, 'notes');
    const bob = await join(b, 'notes');
    await call(alice.socket, 'note:add', { id: 'n1', x: 0, y: 0, color: '#fff59d' });

    expect((await call(alice.socket, 'note:lock', { id: 'n1', name: 'Alice' })).ok).toBe(true);
    const denied = await call(bob.socket, 'note:lock', { id: 'n1', name: 'Bob' });
    expect(denied).toMatchObject({ ok: false, reason: 'locked' });
    expect(denied.note.lockedBy.name).toBe('Alice');
  });

  test('simultaneous lock attempts from two instances produce exactly one winner', async () => {
    const alice = await join(a, 'race');
    const bob = await join(b, 'race');
    await call(alice.socket, 'note:add', { id: 'n1', x: 0, y: 0, color: '#fff59d' });

    const results = await Promise.all([
      call(alice.socket, 'note:lock', { id: 'n1', name: 'Alice' }),
      call(bob.socket, 'note:lock', { id: 'n1', name: 'Bob' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  test('a stale commit is rejected even when the newer edit came through another instance', async () => {
    const alice = await join(a, 'stale');
    const bob = await join(b, 'stale');
    await call(alice.socket, 'note:add', { id: 'n1', x: 0, y: 0, color: '#fff59d' });

    await call(alice.socket, 'note:lock', { id: 'n1' });
    await call(alice.socket, 'note:commit', { id: 'n1', baseVersion: 1, changes: { text: 'from A' } });

    await call(bob.socket, 'note:lock', { id: 'n1' });
    const res = await call(bob.socket, 'note:commit', { id: 'n1', baseVersion: 1, changes: { text: 'from B' } });
    expect(res).toMatchObject({ ok: false, reason: 'stale' });
    expect(res.note).toMatchObject({ text: 'from A', version: 2 });
  });

  test('locks are released when the holder disconnects from their instance', async () => {
    const alice = await join(a, 'disconnect');
    const bob = await join(b, 'disconnect');
    await call(alice.socket, 'note:add', { id: 'n1', x: 0, y: 0, color: '#fff59d' });
    await call(alice.socket, 'note:lock', { id: 'n1' });

    const released = waitFor(bob.socket, 'note:upsert', (n) => n.id === 'n1' && n.lockedBy === null);
    alice.socket.disconnect();
    expect((await released).version).toBe(1);
    expect((await call(bob.socket, 'note:lock', { id: 'n1' })).ok).toBe(true);
  });

  test('clearing on one instance clears the board for users on the other', async () => {
    const alice = await join(a, 'clearing');
    const bob = await join(b, 'clearing');
    alice.socket.emit('stroke:start', { id: 's1', tool: 'pen', color: '#000', points: [0, 0] });
    await call(alice.socket, 'note:add', { id: 'n1', x: 0, y: 0, color: '#fff59d' });

    const cleared = next(bob.socket, 'board:cleared');
    expect(await call(alice.socket, 'board:clear')).toEqual({ ok: true });
    await cleared;

    const { snap } = await join(b, 'clearing');
    expect(snap).toEqual({ strokes: [], notes: {} });
  });
});
