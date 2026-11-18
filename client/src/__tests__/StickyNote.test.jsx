import { render, screen } from '@testing-library/react';
import StickyNote from '../components/StickyNote';

// Shows each Konva element's props as data, so the test can read them.
jest.mock('react-konva', () => {
  const el = (name) => ({ children, ...props }) => (
    <div data-testid={name} data-props={JSON.stringify(props)}>
      {children}
    </div>
  );
  return { Group: el('group'), Rect: el('rect'), Text: el('text') };
});

const props = (element) => JSON.parse(element.dataset.props);
const note = (overrides) => ({ id: 'n1', x: 10, y: 20, text: 'hello', color: '#fff59d', version: 1, lockedBy: null, ...overrides });
const lock = { id: 'other', color: '#2563eb', expiresAt: 123 };
const texts = () => screen.getAllByTestId('text').map((t) => props(t).text);

test('an unlocked note has the plain border and no label', () => {
  render(<StickyNote note={note()} lockedByOther={false} />);
  expect(props(screen.getByTestId('rect')).stroke).toBe('#d4b106');
  expect(texts()).toEqual(['hello']);
});

test('a note someone else is editing gets their color as its border, and says editing without naming them', () => {
  render(<StickyNote note={note({ lockedBy: lock })} lockedByOther />);
  expect(props(screen.getByTestId('rect'))).toMatchObject({ stroke: '#2563eb', strokeWidth: 2 });
  expect(texts()).toEqual(['hello', 'editing']);
  const label = screen.getAllByTestId('text').map(props).find((t) => t.text === 'editing');
  expect(label.fill).toBe('#2563eb');
});

test('a note you are editing yourself has your color around it but no label', () => {
  render(<StickyNote note={note({ lockedBy: lock })} lockedByOther={false} />);
  expect(props(screen.getByTestId('rect')).stroke).toBe('#2563eb');
  expect(texts()).toEqual(['hello']);
});

test('can only be dragged when nobody else is editing it', () => {
  const { rerender } = render(<StickyNote note={note()} lockedByOther={false} />);
  expect(props(screen.getByTestId('group')).draggable).toBe(true);
  rerender(<StickyNote note={note({ lockedBy: lock })} lockedByOther />);
  expect(props(screen.getByTestId('group')).draggable).toBe(false);
});
