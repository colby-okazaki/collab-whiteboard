import { render, screen, fireEvent, act } from '@testing-library/react';
import App from '../App';
import { socket } from '../socket';

// socket.js reads import.meta.env, which Jest can't parse, and App only needs emit.
jest.mock('../socket', () => ({ socket: { emit: jest.fn() } }));

// Konva needs a real canvas, so stand in a Board that just reports the
// active tool and lets the test place a note.
const mockBoardActions = { undo: jest.fn(), redo: jest.fn(), exportPng: jest.fn(), zoomIn: jest.fn(), zoomOut: jest.fn(), resetView: jest.fn() };
jest.mock('../components/Board', () => {
  const { forwardRef, useImperativeHandle } = require('react');
  return {
    __esModule: true,
    default: forwardRef(({ boardId, tool, onNotePlaced, onHistoryChange, onZoomChange }, ref) => {
      useImperativeHandle(ref, () => mockBoardActions);
      return (
        <>
          <span data-testid="tool">{tool}</span>
          <span data-testid="board">{boardId}</span>
          <button onClick={onNotePlaced}>place note</button>
          <button onClick={() => onHistoryChange({ canUndo: true, canRedo: false })}>draw something</button>
          <button onClick={() => onZoomChange(2)}>zoom board</button>
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

  const openDialog = () => {
    fireEvent.click(screen.getByRole('button', { name: 'clear board' }));
    return screen.getByRole('alertdialog');
  };

  test('asks first, inside the page, and clears nothing yet', () => {
    render(<App />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const dialog = openDialog();
    expect(dialog).toHaveTextContent('everyone');
    expect(socket.emit).not.toHaveBeenCalled();
  });

  test('does not depend on the browsers own confirm popup, which can be blocked', () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Clear board' }));
    expect(socket.emit).toHaveBeenCalledWith('board:clear');
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  test('confirming clears the board and closes the dialog', () => {
    render(<App />);
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Clear board' }));
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith('board:clear');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('cancelling does nothing and closes the dialog', () => {
    render(<App />);
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(socket.emit).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('Escape backs out without clearing', () => {
    render(<App />);
    openDialog();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(socket.emit).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('clicking outside the dialog backs out without clearing', () => {
    const { container } = render(<App />);
    openDialog();
    fireEvent.mouseDown(container.ownerDocument.querySelector('.dialog-backdrop'));
    expect(socket.emit).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('clicking inside the dialog does not close it', () => {
    render(<App />);
    openDialog();
    fireEvent.mouseDown(screen.getByRole('alertdialog'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  test('starts on the safe choice, so a stray Enter does not clear the board', () => {
    render(<App />);
    openDialog();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
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

describe('zoom', () => {
  test('shows the level the board reports and sends the buttons to it', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'reset zoom' })).toHaveTextContent('100%');
    fireEvent.click(screen.getByText('zoom board'));
    expect(screen.getByRole('button', { name: 'reset zoom' })).toHaveTextContent('200%');

    fireEvent.click(screen.getByRole('button', { name: 'zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'reset zoom' }));
    expect(mockBoardActions.zoomIn).toHaveBeenCalledTimes(1);
    expect(mockBoardActions.zoomOut).toHaveBeenCalledTimes(1);
    expect(mockBoardActions.resetView).toHaveBeenCalledTimes(1);
  });
});
