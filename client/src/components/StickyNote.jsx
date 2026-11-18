import { Group, Rect, Text } from 'react-konva';

export const NOTE_WIDTH = 160;
export const NOTE_HEIGHT = 120;

export default function StickyNote({ note, lockedByOther, onDragStart, onDragMove, onDragEnd, onDblClick }) {
  const lock = note.lockedBy;
  return (
    <Group
      name="note"
      x={note.x}
      y={note.y}
      draggable={!lockedByOther}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDblClick={onDblClick}
    >
      <Rect
        width={NOTE_WIDTH}
        height={NOTE_HEIGHT}
        fill={note.color}
        cornerRadius={4}
        shadowColor="#000"
        shadowOpacity={0.15}
        shadowBlur={6}
        shadowOffsetY={2}
        stroke={lock ? lock.color : '#d4b106'}
        strokeWidth={lock ? 2 : 1}
        dash={lockedByOther ? [6, 4] : undefined}
      />
      <Text
        text={note.text || (lockedByOther ? '' : 'Double-click to edit')}
        opacity={note.text ? 1 : 0.45}
        width={NOTE_WIDTH}
        height={NOTE_HEIGHT}
        padding={10}
        fontSize={14}
        fill="#222"
      />
      {lockedByOther && (
        <Text text="editing" y={-18} fontSize={12} fill={lock.color} />
      )}
    </Group>
  );
}
