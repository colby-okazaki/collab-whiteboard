import { render, screen, fireEvent, act } from '@testing-library/react';
import Board from '../components/Board';
import { socket } from '../socket';

// Konva needs a real canvas, so the canvas pieces are replaced with plain
// elements. The sticky note stand-in exposes the handlers Board gives it.
jest.mock('react-konva', () => {
  const box = ({ children }) => <div>{children}</div>;
  return { Stage: box, Layer: box, Line: () => null };
});
jest.mock('../components/Cursors', () => ({ __esModule: true, default: () => null }));

// The "node" Konva would hand to the drag handlers.
const mockNode = { x: jest.fn(), y: jest.fn(), position: jest.fn(), stopDrag: jest.fn() };

jest.mock('../components/StickyNote', () => ({
  __esModule: true,
  NOTE_WIDTH: 160,
  NOTE_HEIGHT: 120,
  default: ({ note, lockedByOther, onDragStart, onDragMove, onDragEnd, onDblClick }) => {
    const event = { target: mockNode };
    return (
      <div data-testid={`note-${note.id}`} data-x={note.x} data-y={note.y} data-locked-by-other={String(lockedByOther)}>
        <button onClick={() => onDragStart(event)}>{`start ${note.id}`}</button>
        <button onClick={() => onDragMove(event)}>{`move ${note.id}`}</button>
        <button onClick={() => onDragEnd(event)}>{`end ${note.id}`}</button>
        <button onClick={() => onDblClick()}>{`edit ${note.id}`}</button>
      </div>
    );
  },
}));

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

const note = (overrides) => ({ id: 'n1', x: 10, y: 20, text: 'hello', color: '#fff59d', version: 3, lockedBy: null, ...overrides });
const receive = (event, payload) => act(() => socket.receive(event, payload));
const click = (name) => fireEvent.click(screen.getByRole('button', { name }));
const emitted = (event) => socket.emit.mock.calls.filter(([name]) => name === event).map(([, payload]) => payload);

// Makes the fake server answer events that ask for an acknowledgement.
const serverReplies = (replies) =>
  socket.emit.mockImplementation((event, _payload, ack) => {
    if (typeof ack === 'function' && replies[event]) ack(replies[event]);
  });

beforeEach(() => {
  jest.clearAllMocks();
  socket.emit.mockReset();
  mockNode.x.mockReturnValue(55);
  mockNode.y.mockReturnValue(66);
  render(<Board boardId="room" tool="pen" color="#111111" />);
  receive('board:snapshot', { strokes: [], notes: { n1: note() } });
});

describe('dragging a note', () => {
  test('asks the server for the lock when the drag starts', () => {
    serverReplies({ 'note:lock': { ok: true } });
    click('start n1');
    expect(emitted('note:lock')).toEqual([expect.objectContaining({ id: 'n1', name: expect.any(String) })]);
    expect(mockNode.stopDrag).not.toHaveBeenCalled();
  });

  test('stops the drag and snaps back if another user holds the lock', () => {
    const held = note({ x: 300, y: 400, lockedBy: { id: 'other', name: 'Guest 9', color: '#2563eb' } });
    serverReplies({ 'note:lock': { ok: false, reason: 'locked', note: held } });
    click('start n1');
    expect(mockNode.stopDrag).toHaveBeenCalled();
    expect(mockNode.position).toHaveBeenCalledWith({ x: 300, y: 400 });
    expect(screen.getByTestId('note-n1')).toHaveAttribute('data-x', '300');
  });

  test('streams the position while dragging', () => {
    click('move n1');
    expect(emitted('note:move')).toEqual([{ id: 'n1', x: 55, y: 66 }]);
  });

  test('commits the final position against the version it started from', () => {
    serverReplies({ 'note:commit': { ok: true } });
    click('end n1');
    expect(emitted('note:commit')).toEqual([{ id: 'n1', baseVersion: 3, changes: { x: 55, y: 66 } }]);
    expect(mockNode.position).not.toHaveBeenCalled();
  });

  test('rolls the note back to the server copy when the commit is rejected', () => {
    const current = note({ x: 200, y: 210, version: 4, text: 'changed by someone else' });
    serverReplies({ 'note:commit': { ok: false, reason: 'stale', note: current } });
    click('end n1');
    expect(mockNode.position).toHaveBeenCalledWith({ x: 200, y: 210 });
    expect(screen.getByTestId('note-n1')).toHaveAttribute('data-x', '200');
  });
});

describe('what other users do to a note', () => {
  test("moves along with another user's drag", () => {
    receive('note:moving', { id: 'n1', x: 77, y: 88 });
    expect(screen.getByTestId('note-n1')).toHaveAttribute('data-x', '77');
    expect(screen.getByTestId('note-n1')).toHaveAttribute('data-y', '88');
  });

  test('ignores drag updates for notes it does not have', () => {
    receive('note:moving', { id: 'missing', x: 1, y: 1 });
    expect(screen.queryByTestId('note-missing')).toBeNull();
  });

  test('is marked as locked when someone else holds it, but not when we do', () => {
    receive('note:upsert', note({ lockedBy: { id: 'other', name: 'Guest 9', color: '#2563eb' } }));
    expect(screen.getByTestId('note-n1')).toHaveAttribute('data-locked-by-other', 'true');
    receive('note:upsert', note({ lockedBy: { id: 'me', name: 'Guest 1', color: '#e11d48' } }));
    expect(screen.getByTestId('note-n1')).toHaveAttribute('data-locked-by-other', 'false');
  });
});

describe('editing a note', () => {
  const openEditor = () => {
    serverReplies({ 'note:lock': { ok: true } });
    click('edit n1');
    return screen.getByRole('textbox', { name: 'Note text' });
  };

  test('opens the editor with the current text once the lock is granted', () => {
    expect(openEditor()).toHaveValue('hello');
  });

  test('does not open the editor when the note is locked by someone else', () => {
    serverReplies({ 'note:lock': { ok: false, reason: 'locked' } });
    click('edit n1');
    expect(screen.queryByRole('textbox', { name: 'Note text' })).toBeNull();
  });

  test('saves the new text against the current version when the editor loses focus', () => {
    const editor = openEditor();
    fireEvent.change(editor, { target: { value: 'new text' } });
    fireEvent.blur(editor);
    expect(emitted('note:commit')).toEqual([{ id: 'n1', baseVersion: 3, changes: { text: 'new text' } }]);
    expect(screen.queryByRole('textbox', { name: 'Note text' })).toBeNull();
  });

  test('Cmd+Enter saves', () => {
    const editor = openEditor();
    fireEvent.change(editor, { target: { value: 'via shortcut' } });
    editor.focus();
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    expect(emitted('note:commit')).toEqual([expect.objectContaining({ changes: { text: 'via shortcut' } })]);
  });

  test('a plain Enter adds a line and does not save', () => {
    const editor = openEditor();
    editor.focus();
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(emitted('note:commit')).toHaveLength(0);
    expect(screen.getByRole('textbox', { name: 'Note text' })).toBeInTheDocument();
  });

  test('Escape releases the lock without saving', () => {
    const editor = openEditor();
    fireEvent.change(editor, { target: { value: 'discard me' } });
    editor.focus();
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(emitted('note:unlock')).toEqual([{ id: 'n1' }]);
    expect(emitted('note:commit')).toHaveLength(0);
  });

  test('closes the editor if the note disappears while editing', () => {
    openEditor();
    receive('board:cleared');
    expect(screen.queryByRole('textbox', { name: 'Note text' })).toBeNull();
  });
});

describe('keeping the lock alive', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('renews the lock every 20 seconds while the editor is open, and stops after', () => {
    serverReplies({ 'note:lock': { ok: true } });
    click('edit n1');
    socket.emit.mockClear();

    act(() => jest.advanceTimersByTime(20_000));
    expect(emitted('note:lock')).toHaveLength(1);
    act(() => jest.advanceTimersByTime(20_000));
    expect(emitted('note:lock')).toHaveLength(2);

    fireEvent.blur(screen.getByRole('textbox', { name: 'Note text' }));
    socket.emit.mockClear();
    act(() => jest.advanceTimersByTime(60_000));
    expect(emitted('note:lock')).toHaveLength(0);
  });
});
