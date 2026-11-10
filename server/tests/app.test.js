const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { MemoryBoardStore } = require('../src/store/memoryStore');
const { createPersistence } = require('../src/db/persistence');

async function start(options = {}) {
  const { server, io, shutdown } = createApp({
    store: new MemoryBoardStore(),
    db: createPersistence(undefined),
    clientOrigin: '*',
    ...options,
  });
  await new Promise((resolve) => server.listen(0, resolve));
  return { io, shutdown, url: `http://localhost:${server.address().port}` };
}

describe('createApp', () => {
  let running;
  afterEach(() => new Promise((resolve) => running.io.close(resolve)));

  test('answers health checks', async () => {
    running = await start();
    const res = await fetch(`${running.url}/health`);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('serves the built client when a static directory is given', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-dist-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>whiteboard</h1>');
    running = await start({ staticDir: dir });
    const res = await fetch(`${running.url}/`);
    expect(await res.text()).toBe('<h1>whiteboard</h1>');
  });

  test('serves no pages without a static directory', async () => {
    running = await start();
    expect((await fetch(`${running.url}/`)).status).toBe(404);
  });
});

describe('input validation over the socket', () => {
  const { io: connect } = require('socket.io-client');
  let running;
  let client;
  afterEach(async () => {
    client?.disconnect();
    await new Promise((resolve) => running.io.close(resolve));
  });

  async function open() {
    running = await start();
    client = connect(running.url, { transports: ['websocket'] });
    await new Promise((resolve) => client.on('connect', resolve));
  }
  const call = (event, data) => new Promise((resolve) => client.emit(event, data, resolve));
  const join = (boardId) =>
    new Promise((resolve) => {
      client.once('board:snapshot', resolve);
      client.emit('board:join', boardId);
    });

  test('a valid board id gets a snapshot', async () => {
    await open();
    expect(await join('room-1')).toEqual({ strokes: [], notes: {} });
  });

  test('an invalid board id is ignored, so no board is joined', async () => {
    await open();
    const snapshot = jest.fn();
    client.on('board:snapshot', snapshot);
    client.emit('board:join', '../../etc');
    client.emit('board:join', { $ne: 1 });
    await new Promise((r) => setTimeout(r, 100));
    expect(snapshot).not.toHaveBeenCalled();
  });

  test('a malformed note is rejected and never stored', async () => {
    await open();
    await join('room-2');
    expect(await call('note:add', { id: 'n1', x: 'left', y: 0, color: '#fff59d' })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(await call('note:add', { id: 'n1', x: 1, y: 2, color: '#fff59d' })).toMatchObject({ ok: true });
  });

  test('an oversized stroke batch is dropped without breaking the connection', async () => {
    await open();
    await join('room-3');
    client.emit('stroke:start', { id: 's1', tool: 'pen', color: '#000', points: [0, 0] });
    client.emit('stroke:points', { id: 's1', points: new Array(100_000).fill(1) });
    // The connection still works afterwards.
    expect(await call('note:add', { id: 'n1', x: 1, y: 2, color: '#fff59d' })).toMatchObject({ ok: true });
    const other = connect(running.url, { transports: ['websocket'] });
    const snap = await new Promise((resolve) => {
      other.once('board:snapshot', resolve);
      other.emit('board:join', 'room-3');
    });
    other.disconnect();
    expect(snap.strokes).toEqual([{ id: 's1', tool: 'pen', color: '#000', points: [0, 0] }]);
  });
});

describe('clearing the board', () => {
  const { io: connect } = require('socket.io-client');
  let running;
  const clients = [];
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.disconnect());
    await new Promise((resolve) => running.io.close(resolve));
  });

  async function open(options) {
    running = await start(options);
  }
  async function join(boardId) {
    const socket = connect(running.url, { transports: ['websocket'] });
    clients.push(socket);
    await new Promise((resolve) => {
      socket.once('board:snapshot', resolve);
      socket.emit('board:join', boardId);
    });
    return socket;
  }
  const call = (socket, event, data) => new Promise((resolve) => socket.emit(event, data, resolve));

  test('wipes the board for everyone and tells every user', async () => {
    await open();
    const alice = await join('clear-1');
    const bob = await join('clear-1');
    alice.emit('stroke:start', { id: 's1', tool: 'pen', color: '#000', points: [0, 0] });
    await call(alice, 'note:add', { id: 'n1', x: 1, y: 2, color: '#fff59d' });

    const cleared = new Promise((resolve) => bob.once('board:cleared', resolve));
    expect(await call(alice, 'board:clear')).toEqual({ ok: true });
    await cleared;

    const late = await new Promise((resolve) => {
      const socket = connect(running.url, { transports: ['websocket'] });
      clients.push(socket);
      socket.once('board:snapshot', resolve);
      socket.emit('board:join', 'clear-1');
    });
    expect(late).toEqual({ strokes: [], notes: {} });
  });

  test('only clears the board the user is on', async () => {
    await open();
    const alice = await join('clear-2');
    const bob = await join('keep-2');
    await call(bob, 'note:add', { id: 'n1', x: 1, y: 2, color: '#fff59d' });
    await call(alice, 'board:clear');

    const snap = await new Promise((resolve) => {
      const socket = connect(running.url, { transports: ['websocket'] });
      clients.push(socket);
      socket.once('board:snapshot', resolve);
      socket.emit('board:join', 'keep-2');
    });
    expect(Object.keys(snap.notes)).toEqual(['n1']);
  });

  test('is refused before joining a board', async () => {
    await open();
    const socket = connect(running.url, { transports: ['websocket'] });
    clients.push(socket);
    await new Promise((resolve) => socket.on('connect', resolve));
    expect(await call(socket, 'board:clear')).toEqual({ ok: false, reason: 'not_joined' });
  });

  test('saves and clears reach the database in the order they happened', async () => {
    const calls = [];
    const slow = () => new Promise((resolve) => setTimeout(resolve, 60));
    await open({
      db: {
        init: async () => {},
        loadBoard: async () => null,
        saveStroke: async () => {},
        saveNote: async () => {
          await slow();
          calls.push('save note');
        },
        clearBoard: async () => {
          calls.push('clear');
        },
        close: async () => {},
      },
    });
    const alice = await join('order-1');
    await call(alice, 'note:add', { id: 'n1', x: 1, y: 2, color: '#fff59d' });
    await call(alice, 'board:clear');
    await new Promise((r) => setTimeout(r, 200));
    // Without ordering, the clear would run first and the slow save would
    // then put the deleted note back.
    expect(calls).toEqual(['save note', 'clear']);
  });
});

describe('shutting down', () => {
  const { io: connect } = require('socket.io-client');

  test('saves half-drawn strokes and queued writes before it finishes', async () => {
    const saved = [];
    const slow = () => new Promise((resolve) => setTimeout(resolve, 60));
    const running = await start({
      db: {
        init: async () => {},
        loadBoard: async () => null,
        saveStroke: async (_board, stroke) => {
          await slow();
          saved.push(stroke.id);
        },
        saveNote: async (_board, note) => {
          await slow();
          saved.push(note.id);
        },
        clearBoard: async () => {},
        close: async () => {},
      },
    });
    const socket = connect(running.url, { transports: ['websocket'] });
    await new Promise((resolve) => {
      socket.once('board:snapshot', resolve);
      socket.emit('board:join', 'shutdown-1');
    });
    socket.emit('stroke:start', { id: 's1', tool: 'pen', color: '#000000', points: [0, 0] });
    await new Promise((resolve) => socket.emit('note:add', { id: 'n1', x: 1, y: 2, color: '#fff59d' }, resolve));
    await new Promise((r) => setTimeout(r, 20));

    // The stroke was never ended and the note save is still in flight.
    await running.shutdown();
    expect(saved.sort()).toEqual(['n1', 's1']);
    socket.disconnect();
  });
});
