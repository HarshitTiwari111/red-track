import { useCallback, useState } from 'react';
import { LuTriangleAlert } from 'react-icons/lu';
import Modal from './Modal.jsx';

/**
 * Asks before something irreversible happens.
 *
 * Returned as a promise so the calling code reads top to bottom - `if (!(await
 * confirm(...))) return;` - rather than being split across a callback. That is
 * what the browser's own confirm() gave us, which this replaces: the native
 * dialog cannot say which records are about to go, or what survives them.
 *
 *   const [confirm, confirmUI] = useConfirm();
 *   ...
 *   if (!(await confirm({ title: 'Delete 3 offers?', note: '…' }))) return;
 *   ...
 *   return <Page>{confirmUI}</Page>;
 */
export default function useConfirm() {
  const [state, setState] = useState(null);

  const confirm = useCallback(
    (opts) => new Promise((resolve) => setState({ ...opts, resolve })),
    []
  );

  const close = (answer) => {
    state?.resolve(answer);
    setState(null);
  };

  const ui = state ? (
    <Modal
      small
      title={state.title || 'Are you sure?'}
      onClose={() => close(false)}
      footer={
        <>
          <button type="button" className="btn" onClick={() => close(false)}>
            {state.cancelLabel || 'Cancel'}
          </button>
          <button type="button" className="btn danger solid" onClick={() => close(true)}>
            {state.confirmLabel || 'Delete'}
          </button>
        </>
      }
    >
      <div className="confirm-body">
        <LuTriangleAlert className="confirm-icon" />
        <div>
          <p style={{ margin: 0 }}>{state.message || 'This cannot be undone.'}</p>
          {/* What survives is worth saying: it is the difference between a
              pause and a panic. */}
          {state.note && <p className="dim" style={{ margin: '10px 0 0', fontSize: 13 }}>{state.note}</p>}
        </div>
      </div>
    </Modal>
  ) : null;

  return [confirm, ui];
}
