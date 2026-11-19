import { useEffect, useId, useRef } from 'react';

// A pop-up on the native <dialog>: the browser keeps keyboard focus inside it and Escape closes it.
// Render it only while it is open; when it closes, focus goes back to the button that opened it.
// Clicking outside does not close it, so nothing typed is lost by accident.
export function Modal({ title, badge, onClose, children, footer, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' modal-wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-header">
        <div className="modal-title">
          <h2 id={titleId}>{title}</h2>
          {badge}
        </div>
        <button type="button" className="btn btn-ghost btn-small btn-icon" onClick={onClose}>
          <span aria-hidden="true">×</span>
          <span className="visually-hidden">Close</span>
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </dialog>
  );
}
