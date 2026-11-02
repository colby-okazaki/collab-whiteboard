import { useState } from 'react';
import Toolbar from './components/Toolbar';
import Board from './components/Board';

const BOARD_ID = 'default';

export default function App() {
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#222222');

  return (
    <>
      <Toolbar tool={tool} color={color} onToolChange={setTool} onColorChange={setColor} />
      <Board boardId={BOARD_ID} tool={tool} color={color} onNotePlaced={() => setTool('pen')} />
    </>
  );
}
