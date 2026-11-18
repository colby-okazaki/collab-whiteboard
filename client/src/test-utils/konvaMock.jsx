import { forwardRef, useImperativeHandle } from 'react';

// Stand-in for react-konva, which needs a real canvas. Shapes become plain
// elements, and the Stage turns DOM mouse and touch events into the shape
// Board expects from Konva. The Stage and Layer refs give Board these
// handles, so tests can check what it does with them.
export const stage = { toDataURL: jest.fn(() => 'data:image/png;base64,AAAA') };
export const layer = { hide: jest.fn(), show: jest.fn() };

export function createKonvaMock() {
  // The pointer position on screen, and the same position in board
  // coordinates once the Stage's pan (x, y) and zoom (scale) are undone.
  const stageEvent = (x, y, evt, { x: panX = 0, y: panY = 0, scale = 1 } = {}) => ({
    evt,
    target: {
      findAncestor: () => null,
      getStage: () => ({
        getPointerPosition: () => ({ x, y }),
        getRelativePointerPosition: () => ({ x: (x - panX) / scale, y: (y - panY) / scale }),
      }),
    },
  });
  const el = (name) =>
    forwardRef(({ children, ...props }, ref) => {
      useImperativeHandle(ref, () => layer);
      return (
        <div data-testid={name} data-points={props.points?.join(',')} data-x={props.x} data-y={props.y} data-text={props.text}>
          {children}
        </div>
      );
    });
  const Stage = forwardRef(
    (
      { children, x: panX, y: panY, scaleX, onMouseDown, onMouseMove, onMouseUp, onTouchStart, onTouchMove, onTouchEnd, onWheel },
      ref
    ) => {
      useImperativeHandle(ref, () => stage);
      const view = { x: panX, y: panY, scale: scaleX };
      const touch = (handler) => (e) => handler(stageEvent(e.touches[0].clientX, e.touches[0].clientY, e, view));
      return (
        <div
          data-testid="stage"
          data-view={JSON.stringify(view)}
          onMouseDown={(e) => onMouseDown(stageEvent(e.clientX, e.clientY, e, view))}
          onMouseMove={(e) => onMouseMove(stageEvent(e.clientX, e.clientY, e, view))}
          onMouseUp={onMouseUp}
          onTouchStart={touch(onTouchStart)}
          onTouchMove={touch(onTouchMove)}
          onTouchEnd={(e) => onTouchEnd(stageEvent(0, 0, e, view))}
          onWheel={(e) => onWheel(stageEvent(e.clientX, e.clientY, e, view))}
        >
          {children}
        </div>
      );
    }
  );
  return {
    Stage,
    Layer: el('layer'),
    Line: el('line'),
    Group: el('group'),
    Rect: el('rect'),
    Ellipse: el('ellipse'),
    Circle: el('circle'),
    Text: el('text'),
  };
}
