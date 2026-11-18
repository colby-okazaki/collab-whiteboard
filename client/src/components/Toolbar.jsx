const TOOLS = ['pen', 'eraser', 'line', 'rect', 'ellipse', 'note', 'hand'];

export default function Toolbar({
  tool,
  color,
  onToolChange,
  onColorChange,
  onClear,
  boardId,
  copied = false,
  onShare,
  onNewBoard,
  onExport,
  zoom = 1,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      {TOOLS.map((t) => (
        <button key={t} aria-pressed={tool === t} onClick={() => onToolChange(t)}>
          {t}
        </button>
      ))}
      <input
        type="color"
        aria-label="Pen color"
        value={color}
        onChange={(e) => onColorChange(e.target.value)}
      />
      <button onClick={onUndo} disabled={!canUndo} title="Undo (Cmd/Ctrl+Z)">
        undo
      </button>
      <button onClick={onRedo} disabled={!canRedo} title="Redo (Shift+Cmd/Ctrl+Z)">
        redo
      </button>
      <span className="zoom" role="group" aria-label="Zoom">
        <button onClick={onZoomOut} aria-label="zoom out">
          −
        </button>
        <button onClick={onResetZoom} aria-label="reset zoom" title="Back to 100%">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={onZoomIn} aria-label="zoom in">
          +
        </button>
      </span>
      <span className="board-name" title="Board name">
        {boardId}
      </span>
      <button onClick={onShare}>{copied ? 'link copied' : 'share'}</button>
      <button onClick={onNewBoard}>new board</button>
      <button onClick={onExport} title="Download the board as an image">
        export png
      </button>
      <button className="clear" onClick={onClear}>
        clear board
      </button>
    </div>
  );
}
