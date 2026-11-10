import { useRef, useState } from 'react';
import Toolbar from './components/Toolbar';
import Board from './components/Board';
import { socket } from './socket';

const BOARD_ID = 'default';

export default function App() {
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#222222');
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const board = useRef(null);

  // Clearing wipes the board for every connected user, so ask first.
  const handleClear = () => {
    if (window.confirm('Clear the whole board for everyone? This cannot be undone.')) {
      socket.emit('board:clear');
    }
  };

  return (
    <>
      <Toolbar
        tool={tool}
        color={color}
        onToolChange={setTool}
        onColorChange={setColor}
        onClear={handleClear}
        onUndo={() => board.current?.undo()}
        onRedo={() => board.current?.redo()}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
      />
      <Board
        ref={board}
        boardId={BOARD_ID}
        tool={tool}
        color={color}
        onNotePlaced={() => setTool('pen')}
        onHistoryChange={setHistory}
      />
    </>
  );
}
