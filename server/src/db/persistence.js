const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Durable storage for boards. The in-memory BoardStore stays the live source
// of truth for real-time sync; this layer writes changes behind it and loads
// a board the first time it is opened after a restart.
function createPgPersistence(connectionString) {
  const pool = new Pool({ connectionString });

  return {
    async init() {
      const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      await pool.query(schema);
    },

    async loadBoard(boardId) {
      const [strokes, notes] = await Promise.all([
        pool.query('SELECT id, tool, color, points FROM strokes WHERE board_id = $1 ORDER BY seq', [boardId]),
        pool.query('SELECT id, x, y, text, color, version FROM notes WHERE board_id = $1', [boardId]),
      ]);
      return {
        strokes: strokes.rows,
        notes: Object.fromEntries(notes.rows.map((n) => [n.id, { ...n, lockedBy: null }])),
      };
    },

    async saveStroke(boardId, { id, tool, color, points }) {
      await pool.query(
        `INSERT INTO strokes (id, board_id, tool, color, points)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET points = EXCLUDED.points`,
        [id, boardId, tool, color, JSON.stringify(points)]
      );
    },

    async deleteStroke(boardId, strokeId) {
      await pool.query('DELETE FROM strokes WHERE board_id = $1 AND id = $2', [boardId, strokeId]);
    },

    // Writes are fire-and-forget, so two saves for the same note can land out
    // of order. The version check keeps an older write from replacing a newer one.
    async saveNote(boardId, { id, x, y, text, color, version }) {
      await pool.query(
        `INSERT INTO notes (id, board_id, x, y, text, color, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE
           SET x = EXCLUDED.x, y = EXCLUDED.y, text = EXCLUDED.text,
               version = EXCLUDED.version, updated_at = now()
           WHERE notes.version < EXCLUDED.version`,
        [id, boardId, x, y, text, color, version]
      );
    },

    // One statement, so a board is never left half-cleared.
    async clearBoard(boardId) {
      await pool.query(
        `WITH removed_strokes AS (DELETE FROM strokes WHERE board_id = $1)
         DELETE FROM notes WHERE board_id = $1`,
        [boardId]
      );
    },

    async close() {
      await pool.end();
    },
  };
}

// Used when DATABASE_URL is not set: boards live only in memory.
const memoryPersistence = {
  async init() {},
  async loadBoard() {
    return null;
  },
  async saveStroke() {},
  async saveNote() {},
  async deleteStroke() {},
  async clearBoard() {},
  async close() {},
};

function createPersistence(connectionString) {
  return connectionString ? createPgPersistence(connectionString) : memoryPersistence;
}

module.exports = { createPersistence };
