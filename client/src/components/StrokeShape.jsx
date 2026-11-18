import { Line, Rect, Ellipse } from 'react-konva';

const STROKE_WIDTH = 3;
const ERASER_WIDTH = 20;

// Draws one stroke or shape. A shape is its two corners (or end points) as
// [x1, y1, x2, y2], whichever way it was dragged.
export default function StrokeShape({ stroke: s }) {
  const [x1, y1, x2, y2] = s.points;

  if (s.tool === 'line') {
    return <Line points={s.points} stroke={s.color} strokeWidth={STROKE_WIDTH} lineCap="round" />;
  }
  if (s.tool === 'rect') {
    return (
      <Rect
        x={Math.min(x1, x2)}
        y={Math.min(y1, y2)}
        width={Math.abs(x2 - x1)}
        height={Math.abs(y2 - y1)}
        stroke={s.color}
        strokeWidth={STROKE_WIDTH}
      />
    );
  }
  if (s.tool === 'ellipse') {
    return (
      <Ellipse
        x={(x1 + x2) / 2}
        y={(y1 + y2) / 2}
        radiusX={Math.abs(x2 - x1) / 2}
        radiusY={Math.abs(y2 - y1) / 2}
        stroke={s.color}
        strokeWidth={STROKE_WIDTH}
      />
    );
  }
  return (
    <Line
      points={s.points}
      stroke={s.color}
      strokeWidth={s.tool === 'eraser' ? ERASER_WIDTH : STROKE_WIDTH}
      lineCap="round"
      lineJoin="round"
      tension={0.5}
      globalCompositeOperation={s.tool === 'eraser' ? 'destination-out' : 'source-over'}
    />
  );
}
