import { useCallback, useEffect, useRef, useState } from 'react';
import Toolbar from './components/Toolbar';
import Board from './components/Board';
import ConfirmDialog from './components/ConfirmDialog';
import { socket } from './socket';
import { boardIdFromSearch, boardUrl, newBoardId } from './utils/boardId';

const COPIED_MESSAGE_MS = 2000;

export default function App() {
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#222222');
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const board = useRef(null);
  const [boardId, setBoardId] = useState(() => boardIdFromSearch(window.location.search));
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [confirmingClear, setConfirmingClear] = useState(false);

  // The back and forward buttons move between boards too.
  useEffect(() => {
    const onPopState = () => setBoardId(boardIdFromSearch(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleNewBoard = () => {
    const id = newBoardId();
    window.history.pushState({}, '', boardUrl(id, window.location.href));
    setBoardId(id);
  };

  const handleShare = async () => {
    const link = boardUrl(boardId, window.location.href);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MESSAGE_MS);
    } catch {
      // No clipboard access (e.g. an insecure page): let the user copy it.
      window.prompt('Copy this link to share the board:', link);
    }
  };

  // Clearing wipes the board for every connected user, so ask first.
  const handleClear = () => setConfirmingClear(true);
  const cancelClear = useCallback(() => setConfirmingClear(false), []);
  const confirmClear = () => {
    setConfirmingClear(false);
    socket.emit('board:clear');
  };

  return (
    <>
      <Toolbar
        tool={tool}
        color={color}
        onToolChange={setTool}
        onColorChange={setColor}
        boardId={boardId}
        copied={copied}
        onShare={handleShare}
        onNewBoard={handleNewBoard}
        onExport={() => board.current?.exportPng()}
        zoom={zoom}
        onZoomIn={() => board.current?.zoomIn()}
        onZoomOut={() => board.current?.zoomOut()}
        onResetZoom={() => board.current?.resetView()}
        onClear={handleClear}
        onUndo={() => board.current?.undo()}
        onRedo={() => board.current?.redo()}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
      />
      <Board
        key={boardId}
        ref={board}
        boardId={boardId}
        tool={tool}
        color={color}
        onNotePlaced={() => setTool('pen')}
        onHistoryChange={setHistory}
        onZoomChange={setZoom}
      />
      {confirmingClear && (
        <ConfirmDialog
          title="Clear the board?"
          message="This clears the whole board for everyone, and cannot be undone."
          confirmLabel="Clear board"
          onConfirm={confirmClear}
          onCancel={cancelClear}
        />
      )}
    </>
  );
}
