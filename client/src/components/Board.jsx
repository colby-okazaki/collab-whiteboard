import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Line, Rect } from 'react-konva';
import { socket } from '../socket';
import { me } from '../identity';
import { throttle } from '../utils/throttle';
import { createBatcher } from '../utils/batcher';
import { useWindowSize } from '../hooks/useWindowSize';
import { exportBoardPng } from '../utils/exportBoard';
import Cursors from './Cursors';
import StickyNote, { NOTE_WIDTH, NOTE_HEIGHT } from './StickyNote';

const CURSOR_THROTTLE_MS = 50;
const STROKE_BATCH_MS = 40;
const NOTE_MOVE_THROTTLE_MS = 50;
const NOTE_COLOR = '#fff59d';
// Server locks expire after 60s; renew well before that while editing.
const LOCK_REFRESH_MS = 20_000;
// After placing a note, ignore clicks this long so a double-click doesn't also draw.
const NOTE_PLACED_GRACE_MS = 400;
// How many of your own strokes undo can step back through.
const MAX_HISTORY = 50;

const Board = forwardRef(function Board({ boardId, tool, color, onNotePlaced, onHistoryChange }, ref) {
  const { width, height } = useWindowSize();
  const [strokes, setStrokes] = useState([]);
  const [cursors, setCursors] = useState({});
  const [notes, setNotes] = useState({});
  const [editingId, setEditingId] = useState(null);
  const drawing = useRef(null);
  const editCancelled = useRef(false);
  const notePlacedAt = useRef(0);
  // Your own finished strokes, newest last, for undo and redo.
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const stageRef = useRef(null);
  const cursorLayerRef = useRef(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  const reportHistory = () =>
    onHistoryChange?.({ canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 });

  const putNote = (note) => setNotes((ns) => ({ ...ns, [note.id]: note }));

  const sendCursor = useMemo(
    () => throttle((x, y) => socket.emit('cursor:move', { x, y, ...me }), CURSOR_THROTTLE_MS),
    []
  );

  // Points drawn since the last flush, sent together for the current stroke.
  const pointBatcher = useMemo(
    () =>
      createBatcher((points) => {
        if (drawing.current) socket.emit('stroke:points', { id: drawing.current.id, points });
      }, STROKE_BATCH_MS),
    []
  );

  const sendNoteMove = useMemo(
    () => throttle((id, x, y) => socket.emit('note:move', { id, x, y }), NOTE_MOVE_THROTTLE_MS),
    []
  );

  useEffect(() => {
    socket.connect();
    socket.emit('board:join', boardId);
    socket.on('board:snapshot', (snap) => {
      setStrokes(snap.strokes);
      setNotes(snap.notes);
    });
    socket.on('board:cleared', () => {
      // Drop anything half-finished locally too, so it can't reappear.
      drawing.current = null;
      pointBatcher.cancel();
      setStrokes([]);
      setNotes({});
      setEditingId(null);
      undoStack.current = [];
      redoStack.current = [];
      reportHistory();
    });
    socket.on('stroke:removed', (id) => setStrokes((s) => s.filter((st) => st.id !== id)));
    socket.on('note:upsert', putNote);
    socket.on('note:moving', ({ id, x, y }) =>
      setNotes((ns) => (ns[id] ? { ...ns, [id]: { ...ns[id], x, y } } : ns))
    );
    socket.on('stroke:start', (stroke) => setStrokes((s) => [...s, stroke]));
    socket.on('stroke:points', ({ id, points }) =>
      setStrokes((s) => s.map((st) => (st.id === id ? { ...st, points: [...st.points, ...points] } : st)))
    );
    socket.on('cursor:move', (c) => setCursors((cs) => ({ ...cs, [c.id]: c })));
    socket.on('cursor:leave', (id) =>
      setCursors(({ [id]: _gone, ...rest }) => rest)
    );
    return () => {
      sendCursor.cancel();
      pointBatcher.cancel();
      sendNoteMove.cancel();
      socket.off('board:snapshot');
      socket.off('board:cleared');
      socket.off('stroke:removed');
      socket.off('note:upsert');
      socket.off('note:moving');
      socket.off('stroke:start');
      socket.off('stroke:points');
      socket.off('cursor:move');
      socket.off('cursor:leave');
      socket.disconnect();
    };
  }, [boardId, sendCursor, pointBatcher, sendNoteMove]);

  const handleMouseDown = (e) => {
    // Clicks on a note are for dragging/editing it, not drawing over it.
    if (e.target.findAncestor('.note', true)) return;
    if (Date.now() - notePlacedAt.current < NOTE_PLACED_GRACE_MS) return;
    const { x, y } = e.target.getStage().getPointerPosition();
    if (tool === 'note') {
      socket.emit('note:add', {
        id: crypto.randomUUID(),
        x: x - NOTE_WIDTH / 2,
        y: y - NOTE_HEIGHT / 2,
        text: '',
        color: NOTE_COLOR,
      });
      // One note per click: go back to drawing so a quick second click
      // (e.g. a double-click to edit) doesn't stack another note.
      notePlacedAt.current = Date.now();
      onNotePlaced?.();
      return;
    }
    drawing.current = { id: crypto.randomUUID(), tool, color, points: [x, y] };
    socket.emit('stroke:start', drawing.current);
    setStrokes((s) => [...s, drawing.current]);
  };

  const handleMouseMove = (e) => {
    const { x, y } = e.target.getStage().getPointerPosition();
    sendCursor(x, y);
    if (!drawing.current) return;
    drawing.current = { ...drawing.current, points: [...drawing.current.points, x, y] };
    pointBatcher.push(x, y);
    const current = drawing.current;
    setStrokes((s) => s.map((st) => (st.id === current.id ? current : st)));
  };

  // A touch is followed by compatibility mouse events unless it is cancelled,
  // which would draw the same tap a second time.
  const forTouch = (handler) => (e) => {
    if (e.evt?.cancelable) e.evt.preventDefault();
    handler(e);
  };

  const handleMouseUp = () => {
    if (!drawing.current) return;
    pointBatcher.flush();
    socket.emit('stroke:end', { id: drawing.current.id });
    undoStack.current = [...undoStack.current, drawing.current.id].slice(-MAX_HISTORY);
    redoStack.current = [];
    reportHistory();
    drawing.current = null;
  };

  // Undo takes back your latest stroke that is still on the board (someone
  // may have cleared it meanwhile); redo sends the same stroke back whole.
  const undo = () => {
    while (undoStack.current.length) {
      const id = undoStack.current[undoStack.current.length - 1];
      undoStack.current = undoStack.current.slice(0, -1);
      const stroke = strokesRef.current.find((st) => st.id === id);
      if (!stroke) continue;
      socket.emit('stroke:undo', { id });
      setStrokes((s) => s.filter((st) => st.id !== id));
      redoStack.current = [...redoStack.current, stroke];
      break;
    }
    reportHistory();
  };

  const redo = () => {
    const stroke = redoStack.current[redoStack.current.length - 1];
    if (stroke) {
      redoStack.current = redoStack.current.slice(0, -1);
      socket.emit('stroke:restore', stroke);
      setStrokes((s) => [...s, stroke]);
      undoStack.current = [...undoStack.current, stroke.id].slice(-MAX_HISTORY);
    }
    reportHistory();
  };

  const exportPng = () =>
    exportBoardPng({ stage: stageRef.current, cursorLayer: cursorLayerRef.current, boardId });

  useImperativeHandle(ref, () => ({ undo, redo, exportPng }));

  // Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z or Ctrl+Y redoes. Typing in a note
  // keeps the browser's own text undo.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.target.closest?.('textarea, input')) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Keep the lock alive for as long as the editor is open.
  useEffect(() => {
    if (!editingId) return undefined;
    const timer = setInterval(() => socket.emit('note:lock', { id: editingId, ...me }), LOCK_REFRESH_MS);
    return () => clearInterval(timer);
  }, [editingId]);

  const isLockedByOther = (note) => Boolean(note.lockedBy && note.lockedBy.id !== socket.id);

  // Puts a note back where the server says it is, e.g. after a rejected drag.
  const revert = (node, note) => {
    node.position({ x: note.x, y: note.y });
    putNote(note);
  };

  const handleNoteDragStart = (note) => (e) => {
    const node = e.target;
    socket.emit('note:lock', { id: note.id, ...me }, (res) => {
      if (res.ok) return;
      node.stopDrag();
      if (res.note) revert(node, res.note);
    });
  };

  const handleNoteDragMove = (note) => (e) => sendNoteMove(note.id, e.target.x(), e.target.y());

  const handleNoteDragEnd = (note) => (e) => {
    const node = e.target;
    sendNoteMove.cancel();
    socket.emit(
      'note:commit',
      { id: note.id, baseVersion: note.version, changes: { x: node.x(), y: node.y() } },
      (res) => {
        if (!res.ok && res.note) revert(node, res.note);
      }
    );
  };

  const handleNoteDblClick = (note) => () => {
    socket.emit('note:lock', { id: note.id, ...me }, (res) => {
      if (res.ok) {
        editCancelled.current = false;
        setEditingId(note.id);
      }
    });
  };

  const finishEditing = (e) => {
    const note = notes[editingId];
    setEditingId(null);
    if (!note) return;
    if (editCancelled.current) {
      socket.emit('note:unlock', { id: note.id });
      return;
    }
    socket.emit('note:commit', { id: note.id, baseVersion: note.version, changes: { text: e.target.value } });
  };

  const editingNote = editingId && notes[editingId];

  return (
    <>
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={forTouch(handleMouseDown)}
        onTouchMove={forTouch(handleMouseMove)}
        onTouchEnd={forTouch(handleMouseUp)}
      >
        {/* Paper colour, so exported images are not transparent. */}
        <Layer listening={false}>
          <Rect width={width} height={height} fill="#fafafa" />
        </Layer>
        <Layer>
          {strokes.map((s) => (
            <Line
              key={s.id}
              points={s.points}
              stroke={s.color}
              strokeWidth={s.tool === 'eraser' ? 20 : 3}
              lineCap="round"
              lineJoin="round"
              tension={0.5}
              globalCompositeOperation={s.tool === 'eraser' ? 'destination-out' : 'source-over'}
            />
          ))}
        </Layer>
        <Layer>
          {Object.values(notes).map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              lockedByOther={isLockedByOther(note)}
              onDragStart={handleNoteDragStart(note)}
              onDragMove={handleNoteDragMove(note)}
              onDragEnd={handleNoteDragEnd(note)}
              onDblClick={handleNoteDblClick(note)}
            />
          ))}
        </Layer>
        <Layer ref={cursorLayerRef} listening={false}>
          <Cursors cursors={cursors} />
        </Layer>
      </Stage>
      {editingNote && (
        <textarea
          className="note-editor"
          aria-label="Note text"
          autoFocus
          defaultValue={editingNote.text}
          style={{ left: editingNote.x, top: editingNote.y, width: NOTE_WIDTH, height: NOTE_HEIGHT }}
          onBlur={finishEditing}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              editCancelled.current = true;
              e.target.blur();
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.target.blur();
            }
          }}
        />
      )}
    </>
  );
});

export default Board;
