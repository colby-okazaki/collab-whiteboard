import { render, screen, fireEvent, act } from '@testing-library/react';
import App from '../App';
import { socket } from '../socket';

// socket.js reads import.meta.env, which Jest can't parse, and App only needs emit.
jest.mock('../socket', () => ({ socket: { emit: jest.fn() } }));

// Konva needs a real canvas, so stand in a Board that just reports the
// active tool and lets the test place a note.
const mockBoardActions = { undo: jest.fn(), redo: jest.fn(), exportPng: jest.fn() };
jest.mock('../components/Board', () => {
  const { forwardRef, useImperativeHandle } = require('react');
  return {
    __esModule: true,
    default: forwardRef(({ boardId, tool, onNotePlaced, onHistoryChange }, ref) => {
      useImperativeHandle(ref, () => mockBoardActions);
      return (
        <>
          <span data-testid="tool">{tool}</span>
          <span data-testid="board">{boardId}</span>
          <button onClick={onNotePlaced}>place note</button>
          <button onClick={() => onHistoryChange({ canUndo: true, canRedo: false })}>draw something</button>
        </>
      );
    }),
  };
});

test('switches back to the pen after a note is placed', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'note' }));
  expect(screen.getByTestId('tool')).toHaveTextContent('note');

  fireEvent.click(screen.getByText('place note'));
  expect(screen.getByTestId('tool')).toHaveTextContent('pen');
  expect(screen.getByRole('button', { name: 'pen' })).toHaveAttribute('aria-pressed', 'true');
});

describe('clear board', () => {
  beforeEach(() => socket.emit.mockClear());
  afterEach(() => jest.restoreAllMocks());

  test('asks for confirmation and clears the board when confirmed', () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'clear board' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('everyone'));
    expect(socket.emit).toHaveBeenCalledWith('board:clear');
  });

  test('does nothing when the user cancels', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'clear board' }));
    expect(socket.emit).not.toHaveBeenCalled();
  });
});

describe('undo and redo', () => {
  test('the buttons follow what the board reports and call its undo and redo', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'undo' })).toBeDisabled();

    fireEvent.click(screen.getByText('draw something'));
    expect(screen.getByRole('button', { name: 'undo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'redo' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'undo' }));
    expect(mockBoardActions.undo).toHaveBeenCalledTimes(1);
  });
});

describe('boards in the address', () => {
  const at = (search) => window.history.replaceState({}, '', `/${search}`);
  afterEach(() => at(''));

  test('opens the default board when the address names none', () => {
    render(<App />);
    expect(screen.getByTestId('board')).toHaveTextContent('default');
    expect(screen.getByText('default', { selector: '.board-name' })).toBeInTheDocument();
  });

  test('opens the board named in the address', () => {
    at('?board=team-sync');
    render(<App />);
    expect(screen.getByTestId('board')).toHaveTextContent('team-sync');
  });

  test('ignores a name the server would reject', () => {
    at('?board=<script>');
    render(<App />);
    expect(screen.getByTestId('board')).toHaveTextContent('default');
  });

  test('new board moves to a fresh board and updates the address', () => {
    global.crypto.randomUUID = jest.fn(() => 'abcdef12-3456-7890-abcd-ef1234567890');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'new board' }));
    expect(screen.getByTestId('board')).toHaveTextContent('abcdef1234');
    expect(window.location.search).toBe('?board=abcdef1234');
  });

  test('the back button returns to the previous board', () => {
    global.crypto.randomUUID = jest.fn(() => 'abcdef12-3456-7890-abcd-ef1234567890');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'new board' }));
    act(() => {
      at('');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByTestId('board')).toHaveTextContent('default');
  });

  describe('share', () => {
    afterEach(() => {
      delete navigator.clipboard;
      jest.useRealTimers();
    });

    test('copies the link to this board, then goes back to saying share', async () => {
      jest.useFakeTimers();
      at('?board=team-sync');
      const writeText = jest.fn().mockResolvedValue();
      Object.assign(navigator, { clipboard: { writeText } });
      render(<App />);

      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'share' })));
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?board=team-sync`);
      expect(screen.getByRole('button', { name: 'link copied' })).toBeInTheDocument();

      act(() => jest.advanceTimersByTime(2000));
      expect(screen.getByRole('button', { name: 'share' })).toBeInTheDocument();
    });

    test('shows the link to copy by hand when the clipboard is not available', async () => {
      const prompt = jest.spyOn(window, 'prompt').mockReturnValue(null);
      render(<App />);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'share' })));
      expect(prompt).toHaveBeenCalledWith(expect.any(String), `${window.location.origin}/`);
      prompt.mockRestore();
    });
  });
});

test('export png asks the board to save itself as an image', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'export png' }));
  expect(mockBoardActions.exportPng).toHaveBeenCalledTimes(1);
});
