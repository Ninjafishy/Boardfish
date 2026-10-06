'use strict';

(function initInteractionUtils(root) {
  function createRafCommitter(apply) {
    let raf = null, value0, value1, value2, value3;

    function commit() {
      raf = null;
      apply(value0, value1, value2, value3);
    }

    return {
      schedule(next0, next1, next2, next3) {
        value0 = next0; value1 = next1; value2 = next2; value3 = next3;
        if (raf !== null) return;
        raf = typeof BoardfishView !== 'undefined'
          ? BoardfishView.requestAnimationFrame(commit) : requestAnimationFrame(commit);
      },
      flush() {
        if (raf === null) return;
        if (typeof BoardfishView !== 'undefined') BoardfishView.cancelAnimationFrame(raf);
        else cancelAnimationFrame(raf);
        commit();
      },
    };
  }

  function beginDocumentDrag({ move, up }) {
    const view = typeof BoardfishView !== 'undefined' ? BoardfishView : null;
    const document = view?.document || globalThis.document;
    const dragWindow = view?.window || root;
    let active = true;
    let unsubscribeViewChange;
    const cleanup = (event = null) => {
      if (!active) return;
      active = false;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', cleanup);
      dragWindow.removeEventListener?.('blur', onCancel);
      dragWindow.removeEventListener?.('pagehide', onCancel);
      document.removeEventListener('visibilitychange', onVisibilityChange, true);
      document.removeEventListener('pointercancel', onCancel, true);
      unsubscribeViewChange?.();
      up(event);
    };
    const onCancel = (event) => cleanup({
      __boardfishDragCancel: true,
      type: event?.type || 'cancel',
      clientX: event?.clientX,
      clientY: event?.clientY,
    });
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' || document.hidden) {
        onCancel({ type: 'visibilitychange' });
      }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', cleanup);
    dragWindow.addEventListener?.('blur', onCancel);
    dragWindow.addEventListener?.('pagehide', onCancel);
    document.addEventListener('visibilitychange', onVisibilityChange, true);
    document.addEventListener('pointercancel', onCancel, true);
    unsubscribeViewChange = view?.beforeChange(() => onCancel({ type: 'viewchange' }));
    return cleanup;
  }

  root.beginDocumentDrag = beginDocumentDrag;
  root.createRafCommitter = createRafCommitter;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.freeze({ beginDocumentDrag, createRafCommitter });
  }
})(typeof window !== 'undefined' ? window : globalThis);
