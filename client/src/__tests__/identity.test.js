const load = () => {
  let identity;
  jest.isolateModules(() => {
    identity = require('../identity');
  });
  return identity.me;
};

afterEach(() => {
  window.localStorage.clear();
  jest.restoreAllMocks();
});

test('is a guest name, and no color: the server assigns that', () => {
  const me = load();
  expect(me.name).toMatch(/^Guest \d{1,3}$/);
  expect(me).not.toHaveProperty('color');
});

test('keeps the same name after a refresh', () => {
  const first = load();
  expect(load().name).toBe(first.name);
});

test('uses a name already saved in the browser', () => {
  window.localStorage.setItem('whiteboard-guest-name', 'Guest 42');
  expect(load().name).toBe('Guest 42');
});

test('still works when the browser blocks storage', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(load().name).toMatch(/^Guest \d{1,3}$/);
});
