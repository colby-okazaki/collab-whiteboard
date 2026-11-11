const TOOLS = ['pen', 'eraser', 'note'];

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
      <span className="board-name" title="Board name">
        {boardId}
      </span>
      <button onClick={onShare}>{copied ? 'link copied' : 'share'}</button>
      <button onClick={onNewBoard}>new board</button>
      <button className="clear" onClick={onClear}>
        clear board
      </button>
    </div>
  );
}
