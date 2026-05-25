import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveAppDialog, subscribeAppDialogs } from '../../lib/appDialog';
import './AppDialogHost.css';
import AppButton from '../button/AppButton';

export default function AppDialogHost() {
  const [dialog, setDialog] = useState(null);
  const titleId = useId();
  const descriptionId = useId();
  const cardRef = useRef(null);
  const lastFocusedRef = useRef(null);
  const close = (result) => {
    setDialog((current) => {
      if (current) {
        resolveAppDialog(current.id, result);
      }
      return null;
    });
  };

  useEffect(() => {
    return subscribeAppDialogs((detail) => {
      setDialog(detail);
    });
  }, []);

  useEffect(() => {
    if (!dialog) return undefined;

    lastFocusedRef.current = document.activeElement;

    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const focusFirstElement = () => {
      const focusables = cardRef.current?.querySelectorAll(focusableSelector);
      if (focusables && focusables.length > 0) {
        focusables[0].focus();
      } else {
        cardRef.current?.focus();
      }
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
        return;
      }

      if (event.key !== 'Tab') return;

      const focusables = cardRef.current?.querySelectorAll(focusableSelector);
      if (!focusables || focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const isShift = event.shiftKey;

      if (isShift && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!isShift && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.setTimeout(focusFirstElement, 0);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const target = lastFocusedRef.current;
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
    };
  }, [dialog]);

  if (!dialog) return null;

  return createPortal(
    <div className="app-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <div className="app-dialog-backdrop" onClick={() => close(false)} />
      <div className="app-dialog-card" ref={cardRef} tabIndex={-1}>
        <h4 id={titleId}>{dialog.title}</h4>
        <p id={descriptionId} style={{ whiteSpace: 'pre-wrap' }}>{dialog.message}</p>
        <div className="app-dialog-actions">
          {dialog.type === 'confirm' && (
            <AppButton type="button" className="secundario" onClick={() => close(false)}>
              {dialog.cancelText}
            </AppButton>
          )}
          <AppButton type="button" onClick={() => close(true)}>
            {dialog.confirmText}
          </AppButton>
        </div>
      </div>
    </div>,
    document.body
  );
}

