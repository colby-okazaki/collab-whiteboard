import { useEffect, useRef } from 'react';

// A confirmation shown inside the page. The browser's own confirm() popup is
// blocked or hidden in some environments (embedded browsers, some privacy
// settings), where it silently answers "no" and the action never happens.
export default function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }) {
  const cancelRef = useRef(null);

  // Start on the safe choice, and let Escape back out.
  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-message">
        <h2 id="dialog-title">{title}</h2>
        <p id="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button className="danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
