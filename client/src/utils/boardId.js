// Which board to open comes from the page address (?board=name), so a link
// is all someone needs to join. The rules match the server's, which drops
// anything else; an invalid or missing name falls back to the default board.
export const DEFAULT_BOARD = 'default';
const VALID_BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function boardIdFromSearch(search) {
  const id = new URLSearchParams(search).get('board');
  return id && VALID_BOARD_ID.test(id) ? id : DEFAULT_BOARD;
}

export function newBoardId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

// The current address pointed at another board; other parameters are kept.
export function boardUrl(id, href) {
  const url = new URL(href);
  if (id === DEFAULT_BOARD) url.searchParams.delete('board');
  else url.searchParams.set('board', id);
  return url.toString();
}
