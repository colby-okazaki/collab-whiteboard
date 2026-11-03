const { percentile, summarize } = require('../scripts/stats');

describe('percentile', () => {
  const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];

  test('uses the nearest-rank method regardless of input order', () => {
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 90)).toBe(9);
    expect(percentile(values, 100)).toBe(10);
  });

  test('p0 and tiny percentiles return the smallest value', () => {
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 1)).toBe(1);
  });

  test('does not reorder the input array', () => {
    const input = [3, 1, 2];
    percentile(input, 50);
    expect(input).toEqual([3, 1, 2]);
  });

  test('an empty list has no percentile', () => {
    expect(percentile([], 50)).toBeNaN();
  });
});

test('summarize reports count, extremes and percentiles', () => {
  const s = summarize(Array.from({ length: 100 }, (_, i) => i + 1));
  expect(s).toEqual({ count: 100, min: 1, p50: 50, p95: 95, p99: 99, max: 100 });
});
