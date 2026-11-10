// Integration tests against a real PostgreSQL database.
// Run `npm run db:up` first; skipped when DATABASE_URL is not set.
const { createPersistence } = require('../src/db/persistence');

const url = process.env.DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('PostgreSQL persistence', () => {
  let db;
  const board = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const note = { id: `${board}-n1`, x: 10, y: 20, text: 'hello', color: '#fff59d', version: 1 };

  beforeAll(async () => {
    db = createPersistence(url);
    await db.init();
  });

  // Leave the database as the tests found it.
  afterAll(async () => {
    await db.clearBoard(board);
    await db.close();
  });

  test('an unknown board loads as empty', async () => {
    expect(await db.loadBoard(`${board}-missing`)).toEqual({ strokes: [], notes: {} });
  });

  test('strokes round-trip in drawing order', async () => {
    await db.saveStroke(board, { id: `${board}-s1`, tool: 'pen', color: '#000', points: [0, 0, 1, 1] });
    await db.saveStroke(board, { id: `${board}-s2`, tool: 'eraser', color: '#000', points: [5, 5] });
    const { strokes } = await db.loadBoard(board);
    expect(strokes.map((s) => s.id)).toEqual([`${board}-s1`, `${board}-s2`]);
    expect(strokes[0].points).toEqual([0, 0, 1, 1]);
  });

  test('saving a stroke again updates its points', async () => {
    await db.saveStroke(board, { id: `${board}-s1`, tool: 'pen', color: '#000', points: [0, 0, 1, 1, 2, 2] });
    const { strokes } = await db.loadBoard(board);
    expect(strokes[0].points).toEqual([0, 0, 1, 1, 2, 2]);
  });

  test('a deleted stroke is gone after loading, and others stay', async () => {
    await db.saveStroke(board, { id: `${board}-s3`, tool: 'pen', color: '#000', points: [7, 7] });
    await db.deleteStroke(board, `${board}-s3`);
    await db.deleteStroke(board, `${board}-never-saved`);
    const { strokes } = await db.loadBoard(board);
    expect(strokes.map((s) => s.id)).toEqual([`${board}-s1`, `${board}-s2`]);
  });

  test('deleting a stroke only affects its own board', async () => {
    const other = `${board}-other`;
    await db.saveStroke(other, { id: `${board}-s2`, tool: 'pen', color: '#000', points: [1, 1] });
    await db.deleteStroke(other, `${board}-s2`);
    expect((await db.loadBoard(board)).strokes.map((s) => s.id)).toContain(`${board}-s2`);
  });

  test('notes round-trip unlocked', async () => {
    await db.saveNote(board, note);
    const { notes } = await db.loadBoard(board);
    expect(notes[note.id]).toMatchObject({ x: 10, y: 20, text: 'hello', version: 1, lockedBy: null });
  });

  test('a newer note version replaces an older one', async () => {
    await db.saveNote(board, { ...note, text: 'edited', version: 2 });
    const { notes } = await db.loadBoard(board);
    expect(notes[note.id]).toMatchObject({ text: 'edited', version: 2 });
  });

  test('an out-of-order older write does not overwrite a newer version', async () => {
    await db.saveNote(board, { ...note, text: 'v3', version: 3 });
    await db.saveNote(board, { ...note, text: 'late v2', version: 2 });
    const { notes } = await db.loadBoard(board);
    expect(notes[note.id]).toMatchObject({ text: 'v3', version: 3 });
  });

  test('clearing a board removes its strokes and notes but not other boards', async () => {
    const other = `${board}-other`;
    await db.saveStroke(other, { id: `${other}-s`, tool: 'pen', color: '#000', points: [1, 1] });
    await db.saveNote(other, { ...note, id: `${other}-n` });

    await db.clearBoard(board);

    expect(await db.loadBoard(board)).toEqual({ strokes: [], notes: {} });
    const kept = await db.loadBoard(other);
    expect(kept.strokes).toHaveLength(1);
    expect(Object.keys(kept.notes)).toHaveLength(1);
    await db.clearBoard(other);
  });
});
