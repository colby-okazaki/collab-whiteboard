import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';

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
