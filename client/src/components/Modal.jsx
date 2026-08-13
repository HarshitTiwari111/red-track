import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Rendered through a portal into <body> on purpose. A `position: fixed` backdrop
 * is contained by any ancestor with a transform, filter or backdrop-filter - the
 * topbar has `backdrop-filter: blur()`, so a modal opened from the user menu
 * would otherwise be clipped to the height of the topbar.
 */
export default function Modal({
  title,
  children,
  onClose,
  footer,
  headerActions,
  small = false,
  compact = false,
  wide = false,
  full = false,
}) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal ${small ? 'small' : ''} ${compact ? 'compact' : ''} ${wide ? 'wide' : ''} ${
          full ? 'full' : ''
        }`}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          {headerActions ? (
            <div className="modal-head-actions">{headerActions}</div>
          ) : (
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
