// Benchmarks use throwaway boards. This removes whatever they left behind in
// PostgreSQL and Redis (only when those are configured in the environment).
const { Pool } = require('pg');
const Redis = require('ioredis');

async function cleanupBoard(boardId) {
  const { DATABASE_URL, REDIS_URL } = process.env;

  if (DATABASE_URL) {
    const pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query('DELETE FROM notes WHERE board_id = $1', [boardId]);
    await pool.query('DELETE FROM strokes WHERE board_id = $1', [boardId]);
    await pool.end();
  }

  if (REDIS_URL) {
    const redis = new Redis(REDIS_URL);
    const tag = `board:{${boardId}}`;
    await redis.del(`${tag}:loaded`, `${tag}:stroke-order`, `${tag}:strokes`, `${tag}:notes`);
    await redis.quit();
  }
}

module.exports = { cleanupBoard };
