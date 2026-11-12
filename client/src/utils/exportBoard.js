// Saves what is on the board as a PNG. Other people's cursors are hidden
// for the capture (and always shown again, even if it fails), so the image
// is just the strokes and notes.
export function exportBoardPng({ stage, cursorLayer, boardId, doc = document }) {
  cursorLayer?.hide();
  let dataUrl;
  try {
    // Twice the screen resolution, so the image stays sharp when zoomed.
    dataUrl = stage.toDataURL({ mimeType: 'image/png', pixelRatio: 2 });
  } finally {
    cursorLayer?.show();
  }
  const link = doc.createElement('a');
  link.href = dataUrl;
  link.download = `whiteboard-${boardId}.png`;
  doc.body.appendChild(link);
  link.click();
  link.remove();
}
