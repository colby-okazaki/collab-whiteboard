import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';
import { socket } from '../socket';

// socket.js reads import.meta.env, which Jest can't parse, and App only needs emit.
jest.mock('../socket', () => ({ socket: { emit: jest.fn() } }));

// Konva needs a real canvas, so stand in a Board that just reports the
// active tool and lets the test place a note.
jest.mock('../components/Board', () => ({
  __esModule: true,
  default: ({ tool, onNotePlaced }) => (
    <>
      <span data-testid="tool">{tool}</span>
      <button onClick={onNotePlaced}>place note</button>
    </>
  ),
}));

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
