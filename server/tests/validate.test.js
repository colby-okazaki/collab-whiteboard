const validate = require('../src/validate');

describe('boardId', () => {
  test('accepts short ids made of letters, digits, dashes and underscores', () => {
    expect(validate.boardId('default')).toBe('default');
    expect(validate.boardId('team_1-board')).toBe('team_1-board');
  });

  test.each([
    ['empty', ''],
    ['too long', 'a'.repeat(65)],
    ['spaces', 'my board'],
    ['path characters', '../etc'],
    ['redis pattern characters', 'a*'],
    ['a number', 42],
    ['an object', { $ne: 1 }],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(validate.boardId(value)).toBeNull();
  });
});

describe('strokeStart', () => {
  const good = { id: 's1', tool: 'pen', color: '#222222', points: [1, 2] };

  test('keeps only the known fields', () => {
    expect(validate.strokeStart({ ...good, extra: 'x' })).toEqual(good);
  });

  test.each([
    ['unknown tool', { tool: 'laser' }],
    ['bad color', { color: 'red; background:url(x)' }],
    ['bad id', { id: 'a b' }],
    ['no points', { points: [] }],
    ['odd number of coordinates', { points: [1, 2, 3] }],
    ['non-numeric points', { points: [1, 'a'] }],
    ['NaN point', { points: [1, NaN] }],
    ['huge coordinate', { points: [1, 1e9] }],
    ['too many points', { points: new Array(402).fill(1) }],
  ])('rejects %s', (_label, override) => {
    expect(validate.strokeStart({ ...good, ...override })).toBeNull();
  });

  test('rejects payloads that are not objects', () => {
    expect(validate.strokeStart(null)).toBeNull();
    expect(validate.strokeStart('stroke')).toBeNull();
    expect(validate.strokeStart([good])).toBeNull();
  });
});

describe('strokePoints', () => {
  test('accepts a batch within the size limit', () => {
    const points = new Array(validate.MAX_POINTS_PER_MESSAGE).fill(5);
    expect(validate.strokePoints({ id: 's1', points })).toEqual({ id: 's1', points });
  });

  test('rejects a batch over the limit', () => {
    const points = new Array(validate.MAX_POINTS_PER_MESSAGE + 2).fill(5);
    expect(validate.strokePoints({ id: 's1', points })).toBeNull();
  });
});

describe('cursor', () => {
  test('cleans the name and falls back to a neutral color', () => {
    expect(validate.cursor({ x: 1, y: 2, name: '  Guest\u0000 7  ', color: 'nope' })).toEqual({
      x: 1,
      y: 2,
      name: 'Guest 7',
      color: '#888888',
    });
  });

  test('truncates long names', () => {
    expect(validate.cursor({ x: 0, y: 0, name: 'x'.repeat(100), color: '#fff' }).name).toHaveLength(30);
  });

  test('rejects missing or non-finite coordinates', () => {
    expect(validate.cursor({ x: 1 })).toBeNull();
    expect(validate.cursor({ x: Infinity, y: 0 })).toBeNull();
  });
});

describe('notes', () => {
  test('noteAdd trims text to 1000 characters and keeps known fields', () => {
    const note = validate.noteAdd({ id: 'n1', x: 5, y: 6, color: '#fff59d', text: 'a'.repeat(5000), version: 99 });
    expect(note.text).toHaveLength(1000);
    expect(note).not.toHaveProperty('version');
  });

  test('noteAdd rejects a missing color', () => {
    expect(validate.noteAdd({ id: 'n1', x: 5, y: 6 })).toBeNull();
  });

  test('noteCommit needs an integer base version and a changes object', () => {
    expect(validate.noteCommit({ id: 'n1', baseVersion: 1, changes: { x: 1 } })).not.toBeNull();
    expect(validate.noteCommit({ id: 'n1', baseVersion: '1', changes: {} })).toBeNull();
    expect(validate.noteCommit({ id: 'n1', baseVersion: 1.5, changes: {} })).toBeNull();
    expect(validate.noteCommit({ id: 'n1', baseVersion: 1, changes: null })).toBeNull();
  });

  test('noteMove and noteLock validate ids and coordinates', () => {
    expect(validate.noteMove({ id: 'n1', x: 1, y: 2 })).toEqual({ id: 'n1', x: 1, y: 2 });
    expect(validate.noteMove({ id: 'n1', x: 1 })).toBeNull();
    expect(validate.noteLock({ id: '$bad' })).toBeNull();
  });
});
