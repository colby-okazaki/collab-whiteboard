// Validation for everything a client sends over the socket. Clients are not
// trusted: each function returns a cleaned copy of the payload, or null if it
// is malformed, so handlers only ever work with well-formed data.

const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 30;
const MAX_POINTS_PER_MESSAGE = 400; // 200 x/y pairs, about 8s of drawing at 40ms batches
const MAX_COORD = 100_000;

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;
const TOOLS = new Set(['pen', 'eraser']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && v.length <= MAX_ID_LENGTH && ID_PATTERN.test(v);
const isCoord = (v) => Number.isFinite(v) && Math.abs(v) <= MAX_COORD;
const isColor = (v) => typeof v === 'string' && COLOR_PATTERN.test(v);

// A flat [x1, y1, x2, y2, ...] list.
const isPointList = (v, max) =>
  Array.isArray(v) && v.length > 0 && v.length <= max && v.length % 2 === 0 && v.every(isCoord);

// Names are shown to other users, so keep them short and strip control characters.
const cleanName = (v) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH) : '';

function boardId(v) {
  return isId(v) ? v : null;
}

function strokeStart(p) {
  if (!isObject(p) || !isId(p.id) || !TOOLS.has(p.tool) || !isColor(p.color)) return null;
  if (!isPointList(p.points, MAX_POINTS_PER_MESSAGE)) return null;
  return { id: p.id, tool: p.tool, color: p.color, points: p.points };
}

function strokePoints(p) {
  if (!isObject(p) || !isId(p.id) || !isPointList(p.points, MAX_POINTS_PER_MESSAGE)) return null;
  return { id: p.id, points: p.points };
}

function strokeId(p) {
  return isObject(p) && isId(p.id) ? { id: p.id } : null;
}

function cursor(p) {
  if (!isObject(p) || !isCoord(p.x) || !isCoord(p.y)) return null;
  return { x: p.x, y: p.y, name: cleanName(p.name), color: isColor(p.color) ? p.color : '#888888' };
}

function noteAdd(p) {
  if (!isObject(p) || !isId(p.id) || !isCoord(p.x) || !isCoord(p.y) || !isColor(p.color)) return null;
  const text = typeof p.text === 'string' ? p.text.slice(0, 1000) : '';
  return { id: p.id, x: p.x, y: p.y, text, color: p.color };
}

function noteLock(p) {
  if (!isObject(p) || !isId(p.id)) return null;
  return { id: p.id, name: cleanName(p.name), color: isColor(p.color) ? p.color : '#888888' };
}

function noteMove(p) {
  if (!isObject(p) || !isId(p.id) || !isCoord(p.x) || !isCoord(p.y)) return null;
  return { id: p.id, x: p.x, y: p.y };
}

function noteCommit(p) {
  if (!isObject(p) || !isId(p.id) || !Number.isInteger(p.baseVersion) || !isObject(p.changes)) return null;
  return { id: p.id, baseVersion: p.baseVersion, changes: p.changes };
}

// Events that carry no data of their own (the board comes from the socket).
const none = () => ({});

module.exports = {
  none,
  boardId,
  strokeStart,
  strokePoints,
  strokeId,
  cursor,
  noteAdd,
  noteLock,
  noteMove,
  noteCommit,
  noteUnlock: strokeId,
  MAX_POINTS_PER_MESSAGE,
};
