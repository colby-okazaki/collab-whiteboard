const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createApp } = require('./app');
const { createPersistence } = require('./db/persistence');
const { MemoryBoardStore } = require('./store/memoryStore');
const { RedisBoardStore } = require('./store/redisStore');

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const { DATABASE_URL, REDIS_URL } = process.env;
const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');

// With REDIS_URL, live state and Socket.io broadcasts are shared through
// Redis, so any number of instances can serve the same boards. Without it,
// a single instance keeps live state in memory.
function createLiveState() {
  if (!REDIS_URL) return { store: new MemoryBoardStore() };
  const pub = new Redis(REDIS_URL);
  const sub = pub.duplicate();
  return { store: new RedisBoardStore(REDIS_URL), adapter: createAdapter(pub, sub) };
}

async function main() {
  const db = createPersistence(DATABASE_URL);
  try {
    await db.init();
  } catch (err) {
    console.error('Could not connect to the database:', err.message || err.code);
    console.error('Start it with `npm run db:up`, or unset DATABASE_URL to run in memory.');
    process.exit(1);
  }

  const { store, adapter } = createLiveState();
  const { server, shutdown } = createApp({
    store,
    db,
    clientOrigin: CLIENT_ORIGIN,
    adapter,
    staticDir: fs.existsSync(CLIENT_DIST) ? CLIENT_DIST : undefined,
  });
  server.listen(PORT, () => {
    const storage = DATABASE_URL ? 'PostgreSQL' : 'in-memory only';
    const live = REDIS_URL ? 'Redis (multi-instance)' : 'in-memory (single instance)';
    console.log(`Server listening on :${PORT} (storage: ${storage}, live state: ${live})`);
  });

  // Hosts stop containers with SIGTERM; finish pending saves before exiting.
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received, saving and shutting down`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await shutdown();
      await store.close();
      await db.close();
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err.message);
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main();
