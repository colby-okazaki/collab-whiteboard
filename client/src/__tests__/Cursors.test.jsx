import { render, screen } from '@testing-library/react';
import Cursors from '../components/Cursors';
import { ARROW_PATH, OUTLINE_WIDTH, TIP } from '../utils/pointerCursor';

// Shows each Konva element's props as data, so the test can read them.
jest.mock('react-konva', () => {
  const el = (name) => ({ children, ...props }) => (
    <div data-testid={name} data-props={JSON.stringify(props)}>
      {children}
    </div>
  );
  return { Group: el('group'), Path: el('path'), Text: el('text') };
});

const props = (element) => JSON.parse(element.dataset.props);
const cursors = {
  a: { id: 'a', x: 10, y: 20, color: '#2563eb' },
  b: { id: 'b', x: 300, y: 400, color: '#16a34a' },
};

test('shows one cursor for each person, at their position', () => {
  render(<Cursors cursors={cursors} />);
  const groups = screen.getAllByTestId('group').map(props);
  expect(groups).toHaveLength(2);
  expect(groups.map((g) => [g.x, g.y])).toEqual([
    [10, 20],
    [300, 400],
  ]);
});

test('draws an arrow with an outline in the persons color and a white fill', () => {
  render(<Cursors cursors={{ a: cursors.a }} />);
  expect(props(screen.getByTestId('path'))).toMatchObject({
    data: ARROW_PATH,
    stroke: '#2563eb',
    fill: '#ffffff',
    strokeWidth: OUTLINE_WIDTH,
  });
});

test('puts the arrow tip exactly on the persons position', () => {
  render(<Cursors cursors={{ a: cursors.a }} />);
  expect(props(screen.getByTestId('path'))).toMatchObject({ x: -TIP, y: -TIP });
});

test('shows no names or labels, only the arrow', () => {
  render(<Cursors cursors={cursors} />);
  expect(screen.queryByTestId('text')).toBeNull();
  expect(screen.getAllByTestId('path')).toHaveLength(2);
});

test('different people get different outline colors', () => {
  render(<Cursors cursors={cursors} />);
  expect(screen.getAllByTestId('path').map((p) => props(p).stroke)).toEqual(['#2563eb', '#16a34a']);
});

test('stays the same size on screen however far the board is zoomed', () => {
  render(<Cursors cursors={{ a: cursors.a }} scale={4} />);
  expect(props(screen.getByTestId('group'))).toMatchObject({ scaleX: 0.25, scaleY: 0.25 });
});

test('is normal size at 100%', () => {
  render(<Cursors cursors={{ a: cursors.a }} />);
  expect(props(screen.getByTestId('group'))).toMatchObject({ scaleX: 1, scaleY: 1 });
});

test('never takes mouse events, so it cannot get in the way of drawing', () => {
  render(<Cursors cursors={{ a: cursors.a }} />);
  expect(props(screen.getByTestId('group')).listening).toBe(false);
});

test('shows nothing when nobody else is here', () => {
  render(<Cursors cursors={{}} />);
  expect(screen.queryByTestId('group')).toBeNull();
});
