import { DEFAULT_BOARD, boardIdFromSearch, boardUrl, newBoardId } from '../utils/boardId';

describe('boardIdFromSearch', () => {
  test('reads the board from the address', () => {
    expect(boardIdFromSearch('?board=team-sync_2')).toBe('team-sync_2');
  });

  test('uses the default board when there is none', () => {
    expect(boardIdFromSearch('')).toBe(DEFAULT_BOARD);
    expect(boardIdFromSearch('?server=http://x')).toBe(DEFAULT_BOARD);
    expect(boardIdFromSearch('?board=')).toBe(DEFAULT_BOARD);
  });

  test.each([
    ['spaces', '?board=my board'],
    ['slashes', '?board=a/b'],
    ['markup', '?board=<script>'],
    ['too long', `?board=${'a'.repeat(65)}`],
  ])('falls back to the default for a name with %s', (_label, search) => {
    expect(boardIdFromSearch(search)).toBe(DEFAULT_BOARD);
  });

  test('accepts the longest allowed name', () => {
    const id = 'a'.repeat(64);
    expect(boardIdFromSearch(`?board=${id}`)).toBe(id);
  });
});

describe('boardUrl', () => {
  test('points the address at the board and keeps other parameters', () => {
    expect(boardUrl('abc', 'http://localhost:5173/?server=http://x:4000')).toBe(
      'http://localhost:5173/?server=http%3A%2F%2Fx%3A4000&board=abc'
    );
  });

  test('replaces the board already in the address', () => {
    expect(boardUrl('new', 'http://localhost:5173/?board=old')).toBe('http://localhost:5173/?board=new');
  });

  test('leaves no parameter for the default board', () => {
    expect(boardUrl(DEFAULT_BOARD, 'http://localhost:5173/?board=old')).toBe('http://localhost:5173/');
  });
});

describe('newBoardId', () => {
  // jsdom has no randomUUID, so use Node's real one.
  beforeAll(() => {
    global.crypto.randomUUID = require('crypto').randomUUID;
  });

  test('makes names the board rules accept, different each time', () => {
    const ids = new Set(Array.from({ length: 20 }, newBoardId));
    expect(ids.size).toBe(20);
    ids.forEach((id) => expect(boardIdFromSearch(`?board=${id}`)).toBe(id));
  });
});
