import { forwardRef, useImperativeHandle } from 'react';

// Stand-in for react-konva, which needs a real canvas. Shapes become plain
// elements, and the Stage turns DOM mouse and touch events into the shape
// Board expects from Konva. The Stage and Layer refs give Board these
// handles, so tests can check what it does with them.
export const stage = { toDataURL: jest.fn(() => 'data:image/png;base64,AAAA') };
export const layer = { hide: jest.fn(), show: jest.fn() };

export function createKonvaMock() {
  const stageEvent = (x, y, evt) => ({
    evt,
    target: { findAncestor: () => null, getStage: () => ({ getPointerPosition: () => ({ x, y }) }) },
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
    ({ children, onMouseDown, onMouseMove, onMouseUp, onTouchStart, onTouchMove, onTouchEnd }, ref) => {
      useImperativeHandle(ref, () => stage);
      const touch = (handler) => (e) => handler(stageEvent(e.touches[0].clientX, e.touches[0].clientY, e));
      return (
        <div
          data-testid="stage"
          onMouseDown={(e) => onMouseDown(stageEvent(e.clientX, e.clientY, e))}
          onMouseMove={(e) => onMouseMove(stageEvent(e.clientX, e.clientY, e))}
          onMouseUp={onMouseUp}
          onTouchStart={touch(onTouchStart)}
          onTouchMove={touch(onTouchMove)}
          onTouchEnd={(e) => onTouchEnd(stageEvent(0, 0, e))}
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
    Circle: el('circle'),
    Text: el('text'),
  };
}
