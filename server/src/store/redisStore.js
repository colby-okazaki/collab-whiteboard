const Redis = require('ioredis');
const { LOCK_TTL_MS, isHeldBy, pickNoteChanges, newNote } = require('./rules');

// Live board state shared by every server instance through Redis.
//
// Keys per board (the {boardId} hash tag keeps a board on one Redis Cluster slot):
//   board:{id}:loaded        set once the board has been seeded from PostgreSQL
//   board:{id}:stroke-order  list of stroke ids in drawing order
//   board:{id}:strokes       hash of stroke id -> stroke JSON
//   board:{id}:notes         hash of note id -> note JSON
//
// Anything that reads and then writes a note runs as a Lua script, so the
// lock and version checks are atomic even with many instances racing.
// The scripts mirror the rules in rules.js.

const keys = (boardId) => ({
  loaded: `board:{${boardId}}:loaded`,
  order: `board:{${boardId}}:stroke-order`,
  strokes: `board:{${boardId}}:strokes`,
  notes: `board:{${boardId}}:notes`,
});

// Current time in ms from the Redis server, so every instance agrees on
// lock expiry regardless of its own clock.
const NOW_MS = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
`;

const SCRIPTS = {
  // KEYS: notes | ARGV: noteId, ownerJson, ttlMs
  lockNote: `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return cjson.encode({ ok = false, reason = 'not_found' }) end
local note = cjson.decode(raw)
local owner = cjson.decode(ARGV[2])
${NOW_MS}
local lock = note.lockedBy
if lock ~= cjson.null and lock.id ~= owner.id and lock.expiresAt > now then
  return cjson.encode({ ok = false, reason = 'locked', note = note })
end
owner.expiresAt = now + tonumber(ARGV[3])
note.lockedBy = owner
local out = cjson.encode(note)
redis.call('HSET', KEYS[1], ARGV[1], out)
return '{"ok":true,"note":' .. out .. '}'
`,

  // KEYS: notes | ARGV: noteId, ownerId, baseVersion, changesJson
  commitNote: `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return cjson.encode({ ok = false, reason = 'not_found' }) end
local note = cjson.decode(raw)
local lock = note.lockedBy
if lock == cjson.null or lock.id ~= ARGV[2] then
  return cjson.encode({ ok = false, reason = 'locked', note = note })
end
note.lockedBy = cjson.null
if note.version ~= tonumber(ARGV[3]) then
  local out = cjson.encode(note)
  redis.call('HSET', KEYS[1], ARGV[1], out)
  return '{"ok":false,"reason":"stale","note":' .. out .. '}'
end
for field, value in pairs(cjson.decode(ARGV[4])) do note[field] = value end
note.version = note.version + 1
local out = cjson.encode(note)
redis.call('HSET', KEYS[1], ARGV[1], out)
return '{"ok":true,"note":' .. out .. '}'
`,

  // KEYS: notes | ARGV: noteId, ownerId
  unlockNote: `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return false end
local note = cjson.decode(raw)
if note.lockedBy == cjson.null or note.lockedBy.id ~= ARGV[2] then return false end
note.lockedBy = cjson.null
local out = cjson.encode(note)
redis.call('HSET', KEYS[1], ARGV[1], out)
return out
`,

  // KEYS: notes | ARGV: ownerId
  releaseLocks: `
local entries = redis.call('HGETALL', KEYS[1])
local released = {}
for i = 1, #entries, 2 do
  local note = cjson.decode(entries[i + 1])
  if note.lockedBy ~= cjson.null and note.lockedBy.id == ARGV[1] then
    note.lockedBy = cjson.null
    local out = cjson.encode(note)
    redis.call('HSET', KEYS[1], entries[i], out)
    table.insert(released, out)
  end
end
return released
`,

  // KEYS: strokes | ARGV: strokeId, pointsJson
  appendPoints: `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local stroke = cjson.decode(raw)
for _, p in ipairs(cjson.decode(ARGV[2])) do table.insert(stroke.points, p) end
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(stroke))
return 1
`,

  // KEYS: loaded, order, strokes, notes | ARGV: {"strokes":[[id,json]...],"notes":[[id,json]...]}
  // Only the first instance to get here seeds the board; the rest are no-ops.
  hydrate: `
if redis.call('SET', KEYS[1], '1', 'NX') == false then return 0 end
local data = cjson.decode(ARGV[1])
for _, pair in ipairs(data.strokes) do
  redis.call('RPUSH', KEYS[2], pair[1])
  redis.call('HSET', KEYS[3], pair[1], pair[2])
end
for _, pair in ipairs(data.notes) do
  redis.call('HSET', KEYS[4], pair[1], pair[2])
end
return 1
`,
};

const NUM_KEYS = { lockNote: 1, commitNote: 1, unlockNote: 1, releaseLocks: 1, appendPoints: 1, hydrate: 4 };

class RedisBoardStore {
  constructor(redisUrl, { lockTtlMs = LOCK_TTL_MS } = {}) {
    this.redis = new Redis(redisUrl);
    this.lockTtlMs = lockTtlMs;
    for (const [name, lua] of Object.entries(SCRIPTS)) {
      this.redis.defineCommand(name, { numberOfKeys: NUM_KEYS[name], lua });
    }
  }

  async isLoaded(boardId) {
    return (await this.redis.exists(keys(boardId).loaded)) === 1;
  }

  async hydrate(boardId, { strokes = [], notes = {} }) {
    const k = keys(boardId);
    const data = {
      strokes: strokes.map((s) => [s.id, JSON.stringify(s)]),
      notes: Object.values(notes).map((n) => [n.id, JSON.stringify(n)]),
    };
    return (await this.redis.hydrate(k.loaded, k.order, k.strokes, k.notes, JSON.stringify(data))) === 1;
  }

  async snapshot(boardId) {
    const k = keys(boardId);
    const [[, order], [, strokeMap], [, noteMap]] = await this.redis
      .multi()
      .lrange(k.order, 0, -1)
      .hgetall(k.strokes)
      .hgetall(k.notes)
      .exec();
    const notes = {};
    for (const [id, json] of Object.entries(noteMap)) notes[id] = JSON.parse(json);
    return {
      strokes: order.filter((id) => strokeMap[id]).map((id) => JSON.parse(strokeMap[id])),
      notes,
    };
  }

  async findStroke(boardId, strokeId) {
    const json = await this.redis.hget(keys(boardId).strokes, strokeId);
    return json ? JSON.parse(json) : null;
  }

  async addStroke(boardId, stroke) {
    const k = keys(boardId);
    await this.redis.multi().rpush(k.order, stroke.id).hset(k.strokes, stroke.id, JSON.stringify(stroke)).exec();
    return stroke;
  }

  async appendPoints(boardId, strokeId, points) {
    return (await this.redis.appendPoints(keys(boardId).strokes, strokeId, JSON.stringify(points))) === 1;
  }

  async addNote(boardId, fields) {
    const note = newNote(fields);
    await this.redis.hset(keys(boardId).notes, note.id, JSON.stringify(note));
    return note;
  }

  async lockNote(boardId, noteId, owner) {
    return JSON.parse(await this.redis.lockNote(keys(boardId).notes, noteId, JSON.stringify(owner), this.lockTtlMs));
  }

  async canMove(boardId, noteId, ownerId) {
    const json = await this.redis.hget(keys(boardId).notes, noteId);
    return Boolean(json && isHeldBy(JSON.parse(json), ownerId));
  }

  async commitNote(boardId, noteId, ownerId, baseVersion, changes) {
    const json = await this.redis.commitNote(
      keys(boardId).notes,
      noteId,
      ownerId,
      String(baseVersion),
      JSON.stringify(pickNoteChanges(changes))
    );
    return JSON.parse(json);
  }

  async unlockNote(boardId, noteId, ownerId) {
    const json = await this.redis.unlockNote(keys(boardId).notes, noteId, ownerId);
    return json ? JSON.parse(json) : null;
  }

  async releaseLocks(boardId, ownerId) {
    const released = await this.redis.releaseLocks(keys(boardId).notes, ownerId);
    return released.map((json) => JSON.parse(json));
  }

  // One DEL, so the board is emptied atomically. The loaded marker stays,
  // so the cleared board is not re-seeded from PostgreSQL.
  async clearBoard(boardId) {
    const k = keys(boardId);
    await this.redis.del(k.order, k.strokes, k.notes);
  }

  async close() {
    await this.redis.quit();
  }
}

module.exports = { RedisBoardStore };
