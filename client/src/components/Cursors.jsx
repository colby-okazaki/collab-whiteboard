import { Group, Circle, Label, Tag, Text } from 'react-konva';

// Other people's cursors: a ring in their color with their name on a tag.
// The group is drawn at the inverse of the board's zoom, so a cursor stays
// the same size on screen however far in or out you are.
export default function Cursors({ cursors, scale = 1 }) {
  return Object.entries(cursors).map(([id, c]) => (
    <Group key={id} x={c.x} y={c.y} scaleX={1 / scale} scaleY={1 / scale} listening={false}>
      <Circle radius={10} stroke="#ffffff" strokeWidth={5} />
      <Circle radius={10} stroke={c.color} strokeWidth={3} />
      <Circle radius={2.5} fill={c.color} />
      <Label x={14} y={8}>
        <Tag fill={c.color} cornerRadius={4} />
        <Text text={c.name} fontSize={12} padding={4} fill="#ffffff" />
      </Label>
    </Group>
  ));
}
