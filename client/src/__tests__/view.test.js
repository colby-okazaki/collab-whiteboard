import {
  INITIAL_VIEW,
  MAX_SCALE,
  MIN_SCALE,
  boardToScreen,
  panBy,
  screenToBoard,
  wheelFactor,
  zoomAt,
} from '../utils/view';

describe('zoomAt', () => {
  test('keeps the board point under the mouse where it is', () => {
    const view = { x: 40, y: -30, scale: 1.5 };
    const anchor = { x: 300, y: 200 };
    const before = screenToBoard(view, anchor);
    const zoomed = zoomAt(view, 3, anchor);
    expect(zoomed.scale).toBe(3);
    const after = screenToBoard(zoomed, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  test('zooming in about the origin leaves it in place', () => {
    expect(zoomAt(INITIAL_VIEW, 2, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, scale: 2 });
  });

  test('stops at the minimum and maximum zoom', () => {
    expect(zoomAt(INITIAL_VIEW, 100, { x: 10, y: 10 }).scale).toBe(MAX_SCALE);
    expect(zoomAt(INITIAL_VIEW, 0.0001, { x: 10, y: 10 }).scale).toBe(MIN_SCALE);
  });

  test('at the limit the view does not drift', () => {
    const atMax = zoomAt(INITIAL_VIEW, MAX_SCALE, { x: 200, y: 100 });
    expect(zoomAt(atMax, MAX_SCALE * 2, { x: 200, y: 100 })).toEqual(atMax);
  });

  test('zooming in then back out returns to the same view', () => {
    const view = { x: 25, y: 60, scale: 1 };
    const anchor = { x: 400, y: 300 };
    const back = zoomAt(zoomAt(view, 2.5, anchor), 1, anchor);
    expect(back.x).toBeCloseTo(view.x);
    expect(back.y).toBeCloseTo(view.y);
    expect(back.scale).toBeCloseTo(1);
  });
});

describe('screen and board positions', () => {
  test('screenToBoard and boardToScreen are inverses', () => {
    const view = { x: -120, y: 75, scale: 0.4 };
    const point = { x: 333, y: 444 };
    const round = boardToScreen(view, screenToBoard(view, point));
    expect(round.x).toBeCloseTo(point.x);
    expect(round.y).toBeCloseTo(point.y);
  });

  test('with no pan or zoom they are the same position', () => {
    expect(screenToBoard(INITIAL_VIEW, { x: 12, y: 34 })).toEqual({ x: 12, y: 34 });
  });

  test('a panned and zoomed view maps a click to the right board point', () => {
    // Board origin sits at (100, 50) on screen, at double size.
    expect(screenToBoard({ x: 100, y: 50, scale: 2 }, { x: 300, y: 250 })).toEqual({ x: 100, y: 100 });
  });
});

test('panBy moves the view and leaves the zoom alone', () => {
  expect(panBy({ x: 10, y: 20, scale: 2 }, -5, 15)).toEqual({ x: 5, y: 35, scale: 2 });
});

describe('wheelFactor', () => {
  test('scrolling up zooms in, down zooms out, and no scroll changes nothing', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(0)).toBe(1);
  });

  test('opposite ticks cancel out', () => {
    expect(wheelFactor(40) * wheelFactor(-40)).toBeCloseTo(1);
  });
});
