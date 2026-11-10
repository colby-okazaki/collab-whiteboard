import { createRef } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Board from '../components/Board';
import { socket } from '../socket';

// Konva needs a real canvas, so react-konva is replaced with plain elements.
// Stage turns DOM mouse events into the shape Board expects from Konva.
jest.mock('react-konva', () => {
  const stageEvent = (e) => ({
    target: { findAncestor: () => null, getStage: () => ({ getPointerPosition: () => ({ x: e.clientX, y: e.clientY }) }) },
  });
  const el = (name) => ({ children, ...props }) => (
    <div data-testid={name} data-points={props.points?.join(',')} data-x={props.x} data-y={props.y} data-text={props.text}>
      {children}
    </div>
  );
  return {
    Stage: ({ children, onMouseDown, onMouseMove, onMouseUp }) => (
      <div
        data-testid="stage"
        onMouseDown={(e) => onMouseDown(stageEvent(e))}
        onMouseMove={(e) => onMouseMove(stageEvent(e))}
        onMouseUp={onMouseUp}
      >
        {children}
      </div>
    ),
    Layer: el('layer'),
    Line: el('line'),
    Group: el('group'),
    Rect: el('rect'),
    Circle: el('circle'),
    Text: el('text'),
  };
});

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
const lines = () => screen.queryAllByTestId('line').map((l) => l.dataset.points);
const key = (k, options = {}) => fireEvent.keyDown(window, { key: k, ...options });

// Draws a short stroke; ids come from the counter below.
let counter = 0;
const draw = (x, y) => {
  mouse('mouseDown', x, y);
  mouse('mouseMove', x + 5, y + 5);
  mouse('mouseUp', x + 5, y + 5);
};

let history;
let boardRef;
beforeEach(() => {
  jest.clearAllMocks();
  counter = 0;
  global.crypto.randomUUID = jest.fn(() => `stroke-${++counter}`);
  history = jest.fn();
  boardRef = createRef();
  render(<Board ref={boardRef} boardId="room" tool="pen" color="#111111" onHistoryChange={history} />);
});

const lastHistory = () => history.mock.calls[history.mock.calls.length - 1][0];

describe('undo', () => {
  test('takes back your latest stroke and tells the server', () => {
    draw(0, 0);
    draw(10, 10);
    expect(lines()).toEqual(['0,0,5,5', '10,10,15,15']);

    act(() => boardRef.current.undo());
    expect(lines()).toEqual(['0,0,5,5']);
    expect(emitted('stroke:undo')).toEqual([{ id: 'stroke-2' }]);
  });

  test('steps back through every stroke, then does nothing', () => {
    draw(0, 0);
    draw(10, 10);
    act(() => boardRef.current.undo());
    act(() => boardRef.current.undo());
    act(() => boardRef.current.undo());
    expect(lines()).toEqual([]);
    expect(emitted('stroke:undo')).toHaveLength(2);
  });

  test("never touches other people's strokes", () => {
    receive('stroke:start', { id: 'theirs', tool: 'pen', color: '#222222', points: [9, 9] });
    act(() => boardRef.current.undo());
    expect(lines()).toEqual(['9,9']);
    expect(emitted('stroke:undo')).toHaveLength(0);
  });

  test('skips a stroke that is already gone from the board', () => {
    draw(0, 0);
    draw(10, 10);
    receive('stroke:removed', 'stroke-2');
    act(() => boardRef.current.undo());
    expect(emitted('stroke:undo')).toEqual([{ id: 'stroke-1' }]);
    expect(lines()).toEqual([]);
  });

  test('a stroke removed by the server disappears for everyone viewing', () => {
    receive('stroke:start', { id: 'theirs', tool: 'pen', color: '#222222', points: [9, 9] });
    receive('stroke:removed', 'theirs');
    expect(lines()).toEqual([]);
  });
});

describe('redo', () => {
  test('puts the stroke back whole, and sends all of it to the server', () => {
    draw(0, 0);
    act(() => boardRef.current.undo());
    act(() => boardRef.current.redo());
    expect(lines()).toEqual(['0,0,5,5']);
    expect(emitted('stroke:restore')).toEqual([{ id: 'stroke-1', tool: 'pen', color: '#111111', points: [0, 0, 5, 5] }]);
  });

  test('a restored stroke can be undone again', () => {
    draw(0, 0);
    act(() => boardRef.current.undo());
    act(() => boardRef.current.redo());
    act(() => boardRef.current.undo());
    expect(lines()).toEqual([]);
    expect(emitted('stroke:undo')).toHaveLength(2);
  });

  test('is cleared by drawing something new', () => {
    draw(0, 0);
    act(() => boardRef.current.undo());
    draw(20, 20);
    act(() => boardRef.current.redo());
    expect(emitted('stroke:restore')).toHaveLength(0);
    expect(lines()).toEqual(['20,20,25,25']);
  });

  test('does nothing when there is nothing to redo', () => {
    act(() => boardRef.current.redo());
    expect(emitted('stroke:restore')).toHaveLength(0);
  });
});

describe('what the toolbar is told', () => {
  test('tracks whether undo and redo are available', () => {
    draw(0, 0);
    expect(lastHistory()).toEqual({ canUndo: true, canRedo: false });
    act(() => boardRef.current.undo());
    expect(lastHistory()).toEqual({ canUndo: false, canRedo: true });
    act(() => boardRef.current.redo());
    expect(lastHistory()).toEqual({ canUndo: true, canRedo: false });
  });

  test('clearing the board empties the history', () => {
    draw(0, 0);
    act(() => boardRef.current.undo());
    receive('board:cleared');
    expect(lastHistory()).toEqual({ canUndo: false, canRedo: false });
    act(() => boardRef.current.redo());
    expect(emitted('stroke:restore')).toHaveLength(0);
  });

  test('keeps only the last 50 strokes of history', () => {
    for (let i = 0; i < 52; i++) draw(i, i);
    for (let i = 0; i < 60; i++) act(() => boardRef.current.undo());
    expect(emitted('stroke:undo')).toHaveLength(50);
    expect(lines()).toHaveLength(2);
  });
});

describe('keyboard shortcuts', () => {
  test('Cmd+Z and Ctrl+Z undo, and the page default is prevented', () => {
    draw(0, 0);
    draw(10, 10);
    expect(key('z', { metaKey: true })).toBe(false);
    key('z', { ctrlKey: true });
    expect(lines()).toEqual([]);
  });

  test('Shift+Cmd+Z and Ctrl+Y redo', () => {
    draw(0, 0);
    draw(10, 10);
    key('z', { metaKey: true });
    key('z', { metaKey: true });
    key('z', { metaKey: true, shiftKey: true });
    expect(lines()).toEqual(['0,0,5,5']);
    key('y', { ctrlKey: true });
    expect(lines()).toEqual(['0,0,5,5', '10,10,15,15']);
  });

  test('plain keys and other shortcuts are left alone', () => {
    draw(0, 0);
    expect(key('z')).toBe(true);
    expect(key('c', { metaKey: true })).toBe(true);
    expect(lines()).toEqual(['0,0,5,5']);
  });

  test('inside a text field the browser keeps its own undo', () => {
    draw(0, 0);
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: 'z', metaKey: true });
    field.remove();
    expect(lines()).toEqual(['0,0,5,5']);
  });
});
