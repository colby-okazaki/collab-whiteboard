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
const note = (overrides) => ({ id: 'n1', x: 10, y: 20, text: 'hello', color: '#fff59d', version: 1, lockedBy: null, ...overrides });

beforeEach(() => {
  jest.clearAllMocks();
  global.crypto.randomUUID = jest.fn(() => 'new-id');
});

test('joins the board on mount and leaves on unmount', () => {
  const { unmount } = render(<Board boardId="room" tool="pen" color="#111111" />);
  expect(socket.connect).toHaveBeenCalled();
  expect(socket.emit).toHaveBeenCalledWith('board:join', 'room');
  unmount();
  expect(socket.disconnect).toHaveBeenCalled();
});

test('renders the strokes and notes from the board snapshot', () => {
  render(<Board boardId="room" tool="pen" color="#111111" />);
  receive('board:snapshot', {
    strokes: [{ id: 's1', tool: 'pen', color: '#000000', points: [1, 2, 3, 4] }],
    notes: { n1: note() },
  });
  expect(screen.getByTestId('line')).toHaveAttribute('data-points', '1,2,3,4');
  expect(screen.getAllByTestId('text').some((t) => t.dataset.text === 'hello')).toBe(true);
});

test("streams another user's stroke in as it is drawn", () => {
  render(<Board boardId="room" tool="pen" color="#111111" />);
  receive('stroke:start', { id: 's1', tool: 'pen', color: '#222222', points: [0, 0] });
  receive('stroke:points', { id: 's1', points: [5, 5, 6, 6] });
  expect(screen.getByTestId('line')).toHaveAttribute('data-points', '0,0,5,5,6,6');
});

test('applies note updates from the server and removes cursors that leave', () => {
  render(<Board boardId="room" tool="pen" color="#111111" />);
  receive('note:upsert', note());
  receive('note:upsert', note({ x: 99, version: 2 }));
  expect(screen.getAllByTestId('group').filter((g) => g.dataset.x === '99')).toHaveLength(1);

  receive('cursor:move', { id: 'other', x: 5, y: 6, name: 'Guest 7', color: '#2563eb' });
  expect(screen.getAllByTestId('text').some((t) => t.dataset.text === 'Guest 7')).toBe(true);
  receive('cursor:leave', 'other');
  expect(screen.getAllByTestId('text').some((t) => t.dataset.text === 'Guest 7')).toBe(false);
});

test('drawing sends the stroke start, batched points, and the end', () => {
  render(<Board boardId="room" tool="pen" color="#abcdef" />);
  mouse('mouseDown', 10, 20);
  expect(emitted('stroke:start')).toEqual([{ id: 'new-id', tool: 'pen', color: '#abcdef', points: [10, 20] }]);

  mouse('mouseMove', 30, 40);
  mouse('mouseUp', 30, 40);
  // Mouse-up flushes the points that were still waiting to be batched.
  expect(emitted('stroke:points')).toEqual([{ id: 'new-id', points: [30, 40] }]);
  expect(emitted('stroke:end')).toEqual([{ id: 'new-id' }]);
});

test('moving the mouse sends the local cursor position', () => {
  render(<Board boardId="room" tool="pen" color="#111111" />);
  mouse('mouseMove', 7, 8);
  expect(emitted('cursor:move')[0]).toMatchObject({ x: 7, y: 8 });
});

test('the note tool places one note centered on the click, then ignores a quick second click', () => {
  const onNotePlaced = jest.fn();
  render(<Board boardId="room" tool="note" color="#111111" onNotePlaced={onNotePlaced} />);
  mouse('mouseDown', 500, 300);
  expect(emitted('note:add')).toEqual([{ id: 'new-id', x: 420, y: 240, text: '', color: '#fff59d' }]);
  expect(onNotePlaced).toHaveBeenCalledTimes(1);

  mouse('mouseDown', 500, 300);
  expect(emitted('note:add')).toHaveLength(1);
  expect(emitted('stroke:start')).toHaveLength(0);
});

test('a cleared board removes every stroke and note, and drops a half-drawn stroke', () => {
  render(<Board boardId="room" tool="pen" color="#111111" />);
  receive('board:snapshot', {
    strokes: [{ id: 's1', tool: 'pen', color: '#000000', points: [1, 2, 3, 4] }],
    notes: { n1: note() },
  });
  mouse('mouseDown', 10, 20); // a stroke is in progress when the clear arrives
  expect(screen.getAllByTestId('line')).toHaveLength(2);

  receive('board:cleared');
  expect(screen.queryByTestId('line')).toBeNull();
  expect(screen.queryAllByTestId('text')).toHaveLength(0);

  // Moving on afterwards must not bring the half-drawn stroke back.
  mouse('mouseMove', 30, 40);
  expect(screen.queryByTestId('line')).toBeNull();
});
