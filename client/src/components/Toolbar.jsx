const TOOLS = ['pen', 'eraser', 'note'];

export default function Toolbar({ tool, color, onToolChange, onColorChange, onClear }) {
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
      <button className="clear" onClick={onClear}>
        clear board
      </button>
    </div>
  );
}
