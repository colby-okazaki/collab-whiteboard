const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');
const { MemoryBoardStore } = require('../src/store/memoryStore');
const { createPersistence } = require('../src/db/persistence');

async function start(options = {}) {
  const { server, io } = createApp({
    store: new MemoryBoardStore(),
    db: createPersistence(undefined),
    clientOrigin: '*',
    ...options,
  });
  await new Promise((resolve) => server.listen(0, resolve));
  return { io, url: `http://localhost:${server.address().port}` };
}

describe('createApp', () => {
  let running;
  afterEach(() => new Promise((resolve) => running.io.close(resolve)));

  test('answers health checks', async () => {
    running = await start();
    const res = await fetch(`${running.url}/health`);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('serves the built client when a static directory is given', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-dist-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>whiteboard</h1>');
    running = await start({ staticDir: dir });
    const res = await fetch(`${running.url}/`);
    expect(await res.text()).toBe('<h1>whiteboard</h1>');
  });

  test('serves no pages without a static directory', async () => {
    running = await start();
    expect((await fetch(`${running.url}/`)).status).toBe(404);
  });
});
