import { render, screen } from '@testing-library/react';
import Cursors from '../components/Cursors';

// Shows each Konva element's props as data, so the test can read them.
jest.mock('react-konva', () => {
  const el = (name) => ({ children, ...props }) => (
    <div data-testid={name} data-props={JSON.stringify(props)}>
      {children}
    </div>
  );
  return { Group: el('group'), Circle: el('circle'), Label: el('label'), Tag: el('tag'), Text: el('text') };
});

const props = (element) => JSON.parse(element.dataset.props);
const cursors = {
  a: { id: 'a', x: 10, y: 20, name: 'Guest 7', color: '#2563eb' },
  b: { id: 'b', x: 300, y: 400, name: 'Guest 12', color: '#16a34a' },
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

test('draws a ring in the persons color, on a white halo so it shows on anything', () => {
  render(<Cursors cursors={{ a: cursors.a }} />);
  const circles = screen.getAllByTestId('circle').map(props);
  expect(circles).toContainEqual(expect.objectContaining({ radius: 10, stroke: '#ffffff' }));
  expect(circles).toContainEqual(expect.objectContaining({ radius: 10, stroke: '#2563eb' }));
  expect(circles).toContainEqual(expect.objectContaining({ fill: '#2563eb' }));
});

test('puts the name on a tag in the same color', () => {
  render(<Cursors cursors={{ a: cursors.a }} />);
  expect(props(screen.getByTestId('tag'))).toMatchObject({ fill: '#2563eb' });
  expect(props(screen.getByTestId('text'))).toMatchObject({ text: 'Guest 7', fill: '#ffffff' });
});

test('different people get different colors on screen', () => {
  render(<Cursors cursors={cursors} />);
  const tags = screen.getAllByTestId('tag').map((t) => props(t).fill);
  expect(new Set(tags).size).toBe(2);
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
