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

const receive = (event, payload) => act(() => socket.receive(event, payload));
const stage = () => screen.getByTestId('stage');
const mouse = (type, x, y) => fireEvent[type](stage(), { clientX: x, clientY: y });
const emitted = (event) => socket.emit.mock.calls.filter(([name]) => name === event).map(([, payload]) => payload);
// The page's own rectangles and ellipses; the first rect is the paper background.
const rects = () => screen.getAllByTestId('rect').slice(1);
const ellipses = () => screen.queryAllByTestId('ellipse');
const lines = () => screen.queryAllByTestId('line').map((l) => l.dataset.points);

let counter;
let boardRef;
const setup = (tool) => {
  boardRef = createRef();
  render(<Board ref={boardRef} boardId="room" tool={tool} color="#2563eb" />);
};
const drag = (from, to) => {
  mouse('mouseDown', ...from);
  mouse('mouseMove', ...to);
  mouse('mouseUp', ...to);
};

beforeEach(() => {
  jest.clearAllMocks();
  counter = 0;
  global.crypto.randomUUID = jest.fn(() => `shape-${++counter}`);
});

describe('drawing a shape', () => {
  test('a rectangle is sent whole when you let go, not streamed', () => {
    setup('rect');
    mouse('mouseDown', 10, 20);
    mouse('mouseMove', 110, 90);
    expect(emitted('stroke:restore')).toHaveLength(0);
    mouse('mouseUp', 110, 90);

    expect(emitted('stroke:restore')).toEqual([
      { id: 'shape-1', tool: 'rect', color: '#2563eb', points: [10, 20, 110, 90] },
    ]);
    expect(emitted('stroke:start')).toHaveLength(0);
    expect(emitted('stroke:points')).toHaveLength(0);
    expect(emitted('stroke:end')).toHaveLength(0);
  });

  test('shows the shape as you drag, before anything is sent', () => {
    setup('rect');
    mouse('mouseDown', 10, 20);
    mouse('mouseMove', 110, 90);
    expect(rects()).toHaveLength(1);
    expect(rects()[0]).toHaveAttribute('data-x', '10');
  });

  test('a rectangle dragged up and to the left still starts at its top-left corner', () => {
    setup('rect');
    drag([110, 90], [10, 20]);
    expect(rects()[0]).toHaveAttribute('data-x', '10');
    expect(rects()[0]).toHaveAttribute('data-y', '20');
  });

  test('an ellipse is drawn centred between the two corners', () => {
    setup('ellipse');
    drag([0, 0], [100, 60]);
    expect(emitted('stroke:restore')).toEqual([expect.objectContaining({ tool: 'ellipse', points: [0, 0, 100, 60] })]);
    expect(ellipses()[0]).toHaveAttribute('data-x', '50');
    expect(ellipses()[0]).toHaveAttribute('data-y', '30');
  });

  test('a line is drawn between the two end points', () => {
    setup('line');
    drag([5, 5], [80, 40]);
    expect(emitted('stroke:restore')).toEqual([expect.objectContaining({ tool: 'line', points: [5, 5, 80, 40] })]);
    expect(lines()).toEqual(['5,5,80,40']);
  });

  test('a plain click leaves no shape behind and sends nothing', () => {
    setup('rect');
    drag([10, 10], [11, 11]);
    expect(emitted('stroke:restore')).toHaveLength(0);
    expect(rects()).toHaveLength(0);
  });

  test('clearing the board while dragging drops the half-drawn shape', () => {
    setup('rect');
    mouse('mouseDown', 10, 20);
    mouse('mouseMove', 110, 90);
    receive('board:cleared');
    mouse('mouseUp', 110, 90);
    expect(rects()).toHaveLength(0);
    expect(emitted('stroke:restore')).toHaveLength(0);
  });
});

describe('shapes from other people', () => {
  test.each([
    ['rect', () => rects()],
    ['ellipse', () => ellipses()],
  ])("a %s someone else drew appears on the board", (tool, find) => {
    setup('pen');
    receive('stroke:start', { id: 'theirs', tool, color: '#16a34a', points: [0, 0, 100, 50] });
    expect(find()).toHaveLength(1);
  });

  test('shapes saved with the board appear when joining', () => {
    setup('pen');
    receive('board:snapshot', {
      strokes: [{ id: 's1', tool: 'rect', color: '#16a34a', points: [0, 0, 100, 50] }],
      notes: {},
    });
    expect(rects()).toHaveLength(1);
  });
});

describe('undo and redo with shapes', () => {
  test('a shape can be undone and redone like a stroke', () => {
    setup('rect');
    drag([10, 20], [110, 90]);
    act(() => boardRef.current.undo());
    expect(rects()).toHaveLength(0);
    expect(emitted('stroke:undo')).toEqual([{ id: 'shape-1' }]);

    act(() => boardRef.current.redo());
    expect(rects()).toHaveLength(1);
    expect(emitted('stroke:restore')).toHaveLength(2);
    expect(emitted('stroke:restore')[1]).toMatchObject({ id: 'shape-1', points: [10, 20, 110, 90] });
  });
});
