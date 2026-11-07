// Behavior every board store must share. Run against the in-memory store
// (memoryStore.test.js) and the Redis store (redisStore.test.js) so the Lua
// scripts can't drift from the rules the memory store implements.
//
// makeStore(options) returns a fresh, empty store; afterEach closes it.
function runStoreContract(makeStore) {
  let store;
  const open = async (options) => {
    store = await makeStore(options);
    return store;
  };
  afterEach(async () => {
    if (store) await store.close();
    store = null;
  });

  const alice = { id: 'alice', name: 'Alice', color: '#e11d48' };
  const bob = { id: 'bob', name: 'Bob', color: '#2563eb' };

  describe('strokes', () => {
    test('a new board starts empty', async () => {
      await open();
      expect(await store.snapshot('a')).toEqual({ strokes: [], notes: {} });
    });

    test('strokes are stored per board, in drawing order', async () => {
      await open();
      await store.addStroke('a', { id: 's1', points: [0, 0] });
      await store.addStroke('a', { id: 's2', points: [1, 1] });
      expect((await store.snapshot('a')).strokes.map((s) => s.id)).toEqual(['s1', 's2']);
      expect((await store.snapshot('b')).strokes).toHaveLength(0);
    });

    test('a snapshot is a copy, not a live reference', async () => {
      await open();
      const snap = await store.snapshot('a');
      await store.addStroke('a', { id: 's1', points: [0, 0] });
      expect(snap.strokes).toHaveLength(0);
    });

    test('appendPoints extends an existing stroke', async () => {
      await open();
      await store.addStroke('a', { id: 's1', points: [0, 0] });
      expect(await store.appendPoints('a', 's1', [5, 5, 10, 10])).toBe(true);
      expect((await store.findStroke('a', 's1')).points).toEqual([0, 0, 5, 5, 10, 10]);
    });

    test('appendPoints ignores unknown strokes', async () => {
      await open();
      expect(await store.appendPoints('a', 'missing', [1, 1])).toBe(false);
    });
  });

  describe('sticky note conflict resolution', () => {
    const setup = async (options) => {
      await open(options);
      await store.addNote('a', { id: 'n1', x: 0, y: 0, text: 'hi', color: '#fff59d' });
    };
    const note = async () => (await store.snapshot('a')).notes.n1;

    test('new notes start at version 1 and unlocked', async () => {
      await setup();
      expect(await note()).toMatchObject({ version: 1, lockedBy: null });
    });

    test('locking an unknown note fails', async () => {
      await setup();
      expect(await store.lockNote('a', 'missing', alice)).toEqual({ ok: false, reason: 'not_found' });
    });

    test('only one user can hold a note lock at a time', async () => {
      await setup();
      expect((await store.lockNote('a', 'n1', alice)).ok).toBe(true);
      const res = await store.lockNote('a', 'n1', bob);
      expect(res).toMatchObject({ ok: false, reason: 'locked' });
      expect(res.note.lockedBy).toMatchObject({ id: 'alice', name: 'Alice' });
    });

    test('re-locking a note you already hold succeeds and extends the lock', async () => {
      await setup();
      const first = await store.lockNote('a', 'n1', alice);
      await new Promise((r) => setTimeout(r, 5));
      const again = await store.lockNote('a', 'n1', alice);
      expect(again.ok).toBe(true);
      expect(again.note.lockedBy.expiresAt).toBeGreaterThan(first.note.lockedBy.expiresAt);
    });

    test('an expired lock can be taken by someone else', async () => {
      await setup({ lockTtlMs: 50 });
      await store.lockNote('a', 'n1', alice);
      expect((await store.lockNote('a', 'n1', bob)).ok).toBe(false);
      await new Promise((r) => setTimeout(r, 80));
      const res = await store.lockNote('a', 'n1', bob);
      expect(res.ok).toBe(true);
      expect(res.note.lockedBy.id).toBe('bob');
    });

    test('only the lock holder may broadcast drag positions', async () => {
      await setup();
      await store.lockNote('a', 'n1', alice);
      expect(await store.canMove('a', 'n1', 'alice')).toBe(true);
      expect(await store.canMove('a', 'n1', 'bob')).toBe(false);
    });

    test('committing applies changes, bumps the version, and releases the lock', async () => {
      await setup();
      await store.lockNote('a', 'n1', alice);
      const res = await store.commitNote('a', 'n1', 'alice', 1, { x: 50.5, y: 60, text: 'moved' });
      expect(res.ok).toBe(true);
      expect(res.note).toMatchObject({ x: 50.5, y: 60, text: 'moved', version: 2, lockedBy: null });
      expect(await note()).toEqual(res.note);
    });

    test('commits without the lock are rejected', async () => {
      await setup();
      await store.lockNote('a', 'n1', alice);
      const res = await store.commitNote('a', 'n1', 'bob', 1, { text: 'overwrite' });
      expect(res).toMatchObject({ ok: false, reason: 'locked' });
      expect((await note()).text).toBe('hi');
    });

    test('a stale commit is rejected and the lock is released', async () => {
      await setup();
      // Alice edits and commits (v1 -> v2).
      await store.lockNote('a', 'n1', alice);
      await store.commitNote('a', 'n1', 'alice', 1, { text: 'alice was here' });
      // Bob's client still thinks the note is v1 when he grabs it.
      await store.lockNote('a', 'n1', bob);
      const res = await store.commitNote('a', 'n1', 'bob', 1, { x: 999 });
      expect(res).toMatchObject({ ok: false, reason: 'stale' });
      expect(res.note).toMatchObject({ text: 'alice was here', x: 0, version: 2, lockedBy: null });
      expect(await note()).toEqual(res.note);
    });

    test('only position and text can be changed', async () => {
      await setup();
      await store.lockNote('a', 'n1', alice);
      const { note: saved } = await store.commitNote('a', 'n1', 'alice', 1, { version: 100, color: 'red', x: 'NaN' });
      expect(saved).toMatchObject({ version: 2, color: '#fff59d', x: 0 });
    });

    test('unlock only works for the lock holder', async () => {
      await setup();
      await store.lockNote('a', 'n1', alice);
      expect(await store.unlockNote('a', 'n1', 'bob')).toBeNull();
      expect((await store.unlockNote('a', 'n1', 'alice')).lockedBy).toBeNull();
    });

    test("disconnecting releases all of that user's locks", async () => {
      await setup();
      await store.addNote('a', { id: 'n2', x: 0, y: 0, color: '#fff59d' });
      await store.addNote('a', { id: 'n3', x: 0, y: 0, color: '#fff59d' });
      await store.lockNote('a', 'n1', alice);
      await store.lockNote('a', 'n2', alice);
      await store.lockNote('a', 'n3', bob);
      const released = await store.releaseLocks('a', 'alice');
      expect(released.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
      expect((await store.lockNote('a', 'n1', bob)).ok).toBe(true);
      expect((await store.snapshot('a')).notes.n3.lockedBy.id).toBe('bob');
    });
  });

  describe('clearBoard', () => {
    const fill = async () => {
      await open();
      await store.addStroke('a', { id: 's1', points: [0, 0] });
      await store.addNote('a', { id: 'n1', x: 0, y: 0, text: 'hi', color: '#fff59d' });
      await store.lockNote('a', 'n1', alice);
    };

    test('removes every stroke and note, locks included', async () => {
      await fill();
      await store.clearBoard('a');
      expect(await store.snapshot('a')).toEqual({ strokes: [], notes: {} });
    });

    test('leaves other boards alone', async () => {
      await fill();
      await store.addStroke('b', { id: 's2', points: [1, 1] });
      await store.clearBoard('a');
      expect((await store.snapshot('b')).strokes.map((s) => s.id)).toEqual(['s2']);
    });

    test('keeps the board loaded, so it is not re-seeded from saved data', async () => {
      await fill();
      await store.hydrate('a', { strokes: [{ id: 'old', points: [9, 9] }], notes: {} });
      await store.clearBoard('a');
      expect(await store.isLoaded('a')).toBe(true);
      expect(await store.hydrate('a', { strokes: [{ id: 'old', points: [9, 9] }], notes: {} })).toBe(false);
      expect((await store.snapshot('a')).strokes).toEqual([]);
    });

    test('late updates for cleared content are rejected', async () => {
      await fill();
      await store.clearBoard('a');
      expect(await store.appendPoints('a', 's1', [5, 5])).toBe(false);
      expect(await store.commitNote('a', 'n1', 'alice', 1, { x: 5 })).toEqual({ ok: false, reason: 'not_found' });
      expect(await store.canMove('a', 'n1', 'alice')).toBe(false);
    });

    test('the board can be used again afterwards', async () => {
      await fill();
      await store.clearBoard('a');
      await store.addNote('a', { id: 'n1', x: 3, y: 4, color: '#fff59d' });
      expect((await store.snapshot('a')).notes.n1).toMatchObject({ x: 3, y: 4, version: 1, lockedBy: null });
    });
  });

  describe('hydrate', () => {
    const saved = {
      strokes: [{ id: 's1', tool: 'pen', color: '#000', points: [0, 0, 1, 1] }],
      notes: { n1: { id: 'n1', x: 1, y: 2, text: 'saved', color: '#fff59d', version: 3, lockedBy: null } },
    };

    test('loads saved strokes and notes into a board', async () => {
      await open();
      expect(await store.isLoaded('a')).toBe(false);
      expect(await store.hydrate('a', saved)).toBe(true);
      expect(await store.isLoaded('a')).toBe(true);
      expect(await store.snapshot('a')).toEqual(saved);
    });

    test('only the first hydrate wins, so live state is never replaced', async () => {
      await open();
      await store.hydrate('a', saved);
      await store.addStroke('a', { id: 's2', points: [2, 2] });
      expect(await store.hydrate('a', { strokes: [], notes: {} })).toBe(false);
      expect((await store.snapshot('a')).strokes.map((s) => s.id)).toEqual(['s1', 's2']);
    });

    test('hydrated notes keep their version for conflict checks', async () => {
      await open();
      await store.hydrate('a', saved);
      await store.lockNote('a', 'n1', alice);
      expect((await store.commitNote('a', 'n1', 'alice', 1, { x: 5 })).reason).toBe('stale');
    });
  });
}

module.exports = { runStoreContract };
