const { createRateLimiter } = require('../src/rateLimit');

const setup = (options) => {
  let time = 0;
  const limiter = createRateLimiter({ now: () => time, ...options });
  return { limiter, advance: (ms) => (time += ms) };
};
const count = (limiter, tries) => Array.from({ length: tries }, () => limiter.allow()).filter(Boolean).length;

test('allows a burst up to its capacity, then refuses', () => {
  const { limiter } = setup({ capacity: 10, perSecond: 5 });
  expect(count(limiter, 25)).toBe(10);
});

test('refills at the given rate', () => {
  const { limiter, advance } = setup({ capacity: 10, perSecond: 5 });
  count(limiter, 10);
  advance(1000);
  expect(count(limiter, 20)).toBe(5);
});

test('credits part of a token for a short wait, and spends whole ones', () => {
  const { limiter, advance } = setup({ capacity: 1, perSecond: 10 });
  expect(limiter.allow()).toBe(true);
  advance(50);
  expect(limiter.allow()).toBe(false);
  advance(50);
  expect(limiter.allow()).toBe(true);
});

test('never stores more than its capacity, however long it was idle', () => {
  const { limiter, advance } = setup({ capacity: 10, perSecond: 5 });
  advance(60 * 60 * 1000);
  expect(count(limiter, 50)).toBe(10);
});

test('a steady rate under the limit is never refused', () => {
  const { limiter, advance } = setup({ capacity: 10, perSecond: 100 });
  let refused = 0;
  for (let i = 0; i < 1000; i++) {
    advance(20); // 50 messages a second
    if (!limiter.allow()) refused++;
  }
  expect(refused).toBe(0);
});

test('a steady rate over the limit is held to the limit', () => {
  const { limiter, advance } = setup({ capacity: 10, perSecond: 100 });
  let allowed = 0;
  for (let i = 0; i < 10_000; i++) {
    advance(5); // 200 messages a second for 50 seconds
    if (limiter.allow()) allowed++;
  }
  // About 100 a second for 50 seconds, plus the initial burst.
  expect(allowed).toBeGreaterThan(5000);
  expect(allowed).toBeLessThan(5100);
});
