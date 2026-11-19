import { Group, Path } from 'react-konva';
import { ARROW_PATH, OUTLINE_WIDTH, TIP } from '../utils/pointerCursor';

// Other people's cursors: the same arrow as a normal pointer, with an outline
// in their color so people can be told apart without names. The arrow's tip is
// at the person's position. The group is drawn at the inverse of the board's
// zoom, so a cursor stays the same size on screen however far in or out you are.
export default function Cursors({ cursors, scale = 1 }) {
  return Object.entries(cursors).map(([id, c]) => (
    <Group key={id} x={c.x} y={c.y} scaleX={1 / scale} scaleY={1 / scale} listening={false}>
      <Path
        x={-TIP}
        y={-TIP}
        data={ARROW_PATH}
        fill="#ffffff"
        stroke={c.color}
        strokeWidth={OUTLINE_WIDTH}
        lineJoin="round"
      />
    </Group>
  ));
}
