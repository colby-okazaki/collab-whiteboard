import { createRef } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Board from '../components/Board';
import { socket } from '../socket';

// Konva needs a real canvas, so react-konva is replaced with plain elements.
// Stage turns DOM mouse events into the shape Board expects from Konva.
jest.mock('react-konva', () => require('../test-utils/konvaMock').createKonvaMock());

// A fake socket that lets tests push server events into the component.
jest.mock('../socket', () => {
  const mockHandlers = {};
  return {
    socket: {
      id: 'me',
      connect: jest.fn(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      on: jest.fn((event, handler) => {
        mockHandlers[event] = handler;
      }),
      off: jest.fn(),
      receive: (event, ...args) => mockHandlers[event](...args),
    },
  };
});

const stage = () => screen.getByTestId('stage');
const mouse = (type, x, y) => fireEvent[type](stage(), { clientX: x, clientY: y });
const wheel = (init) => fireEvent.wheel(stage(), init);
const view = () => JSON.parse(stage().dataset.view);
const emitted = (event) => socket.emit.mock.calls.filter(([name]) => name === event).map(([, payload]) => payload);

let boardRef;
let onZoomChange;
const setup = (tool = 'pen', props = {}) => {
  boardRef = createRef();
  onZoomChange = jest.fn();
  return render(<Board ref={boardRef} boardId="room" tool={tool} color="#111111" onZoomChange={onZoomChange} {...props} />);
};

beforeEach(() => {
  jest.clearAllMocks();
  let n = 0;
  global.crypto.randomUUID = jest.fn(() => `id-${++n}`);
});

describe('zooming', () => {
  test('Ctrl+wheel zooms in and out, and a trackpad pinch (which sends the same) does too', () => {
    setup();
    wheel({ clientX: 200, clientY: 100, deltaY: -100, ctrlKey: true });
    expect(view().scale).toBeGreaterThan(1);
    wheel({ clientX: 200, clientY: 100, deltaY: 300, ctrlKey: true });
    expect(view().scale).toBeLessThan(1);
  });

  test('Cmd+wheel zooms too', () => {
    setup();
    wheel({ clientX: 0, clientY: 0, deltaY: -100, metaKey: true });
    expect(view().scale).toBeGreaterThan(1);
  });

  test('the point under the mouse stays under the mouse', () => {
    setup();
    wheel({ clientX: 200, clientY: 100, deltaY: -150, ctrlKey: true });
    // Drawing there still lands on the same board point as before zooming.
    mouse('mouseDown', 200, 100);
    expect(emitted('stroke:start')[0].points[0]).toBeCloseTo(200);
    expect(emitted('stroke:start')[0].points[1]).toBeCloseTo(100);
  });

  test('zoom has limits at both ends', () => {
    setup();
    for (let i = 0; i < 40; i++) wheel({ clientX: 10, clientY: 10, deltaY: -200, ctrlKey: true });
    expect(view().scale).toBe(5);
    for (let i = 0; i < 80; i++) wheel({ clientX: 10, clientY: 10, deltaY: 200, ctrlKey: true });
    expect(view().scale).toBe(0.1);
  });

  test('the zoom buttons zoom around the middle of the window and can be reset', () => {
    setup();
    act(() => boardRef.current.zoomIn());
    expect(view().scale).toBeCloseTo(1.25);
    act(() => boardRef.current.zoomOut());
    act(() => boardRef.current.zoomOut());
    expect(view().scale).toBeCloseTo(0.8);
    act(() => boardRef.current.resetView());
    expect(view()).toEqual({ x: 0, y: 0, scale: 1 });
  });

  test('tells the app the zoom level as it changes', () => {
    setup();
    expect(onZoomChange).toHaveBeenLastCalledWith(1);
    act(() => boardRef.current.zoomIn());
    expect(onZoomChange).toHaveBeenLastCalledWith(1.25);
  });
});

describe('panning', () => {
  test('a plain wheel or two-finger scroll moves the view', () => {
    setup();
    wheel({ clientX: 50, clientY: 50, deltaX: 20, deltaY: 50 });
    expect(view()).toEqual({ x: -20, y: -50, scale: 1 });
  });

  test('the hand tool drags the board around without drawing', () => {
    setup('hand');
    mouse('mouseDown', 100, 100);
    mouse('mouseMove', 160, 130);
    mouse('mouseUp', 160, 130);
    expect(view()).toEqual({ x: 60, y: 30, scale: 1 });
    expect(emitted('stroke:start')).toHaveLength(0);
    expect(emitted('stroke:restore')).toHaveLength(0);
  });

  test('moving the mouse over the board with the hand tool does not pan until you press', () => {
    setup('hand');
    mouse('mouseMove', 160, 130);
    expect(view().x).toBe(0);
  });

  test('a second drag carries on from where the first one left the board', () => {
    setup('hand');
    mouse('mouseDown', 0, 0);
    mouse('mouseMove', 40, 10);
    mouse('mouseUp', 40, 10);
    mouse('mouseDown', 500, 500);
    mouse('mouseMove', 520, 505);
    mouse('mouseUp', 520, 505);
    expect(view()).toEqual({ x: 60, y: 15, scale: 1 });
  });

  test('uses a grab cursor while the hand tool is active, and restores it', () => {
    const { rerender, unmount } = setup('hand');
    expect(document.body.style.cursor).toBe('grab');
    rerender(<Board boardId="room" tool="pen" color="#111111" />);
    expect(document.body.style.cursor).toBe('');
    rerender(<Board boardId="room" tool="hand" color="#111111" />);
    unmount();
    expect(document.body.style.cursor).toBe('');
  });
});

describe('everything is placed in board coordinates', () => {
  const panAndZoom = () => {
    // Board origin at (100, 50) on screen, at double size.
    wheel({ clientX: 0, clientY: 0, deltaX: -100, deltaY: -50 });
    act(() => {
      boardRef.current.zoomIn();
    });
  };

  test('strokes start at the board point under the pointer', () => {
    setup();
    wheel({ clientX: 0, clientY: 0, deltaX: -100, deltaY: -50 });
    mouse('mouseDown', 300, 250);
    expect(emitted('stroke:start')[0].points).toEqual([200, 200]);
  });

  test('shapes are sent in board coordinates', () => {
    setup('rect');
    wheel({ clientX: 0, clientY: 0, deltaX: -100, deltaY: -50 });
    mouse('mouseDown', 150, 100);
    mouse('mouseMove', 350, 250);
    mouse('mouseUp', 350, 250);
    expect(emitted('stroke:restore')[0].points).toEqual([50, 50, 250, 200]);
  });

  test('notes are placed at the board point, centred', () => {
    setup('note');
    wheel({ clientX: 0, clientY: 0, deltaX: -100, deltaY: -50 });
    mouse('mouseDown', 300, 250);
    expect(emitted('note:add')[0]).toMatchObject({ x: 200 - 80, y: 200 - 60 });
  });

  test('your cursor is sent in board coordinates, so others see it in the right place', () => {
    setup();
    wheel({ clientX: 0, clientY: 0, deltaX: -100, deltaY: -50 });
    mouse('mouseMove', 300, 250);
    expect(emitted('cursor:move')[0]).toMatchObject({ x: 200, y: 200 });
  });

  test('the paper background always covers the whole window', () => {
    setup();
    panAndZoom();
    const { x, y, scale } = view();
    const [background] = screen.getAllByTestId('rect');
    expect(Number(background.dataset.x)).toBeCloseTo(-x / scale);
    expect(Number(background.dataset.y)).toBeCloseTo(-y / scale);
  });
});

describe('after the board changes', () => {
  test('a cleared board keeps the view where you were looking', () => {
    setup();
    wheel({ clientX: 0, clientY: 0, deltaX: -100, deltaY: -50 });
    act(() => socket.receive('board:cleared'));
    expect(view().x).toBe(100);
  });
});
