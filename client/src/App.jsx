import { useState } from 'react';
import Toolbar from './components/Toolbar';
import Board from './components/Board';
import { socket } from './socket';

const BOARD_ID = 'default';

export default function App() {
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#222222');

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
      />
      <Board boardId={BOARD_ID} tool={tool} color={color} onNotePlaced={() => setTool('pen')} />
    </>
  );
}
