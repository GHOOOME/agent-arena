import { useCallback, useRef } from 'react';

type KeyboardEventLike = React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>;

export function useImeEnterSubmit(onSubmit: () => void, canSubmit = true) {
  const composingRef = useRef(false);
  const justComposedRef = useRef(false);
  const releaseTimerRef = useRef<number | null>(null);

  const releaseJustComposed = useCallback(() => {
    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current);
    }
    releaseTimerRef.current = window.setTimeout(() => {
      justComposedRef.current = false;
      releaseTimerRef.current = null;
    }, 80);
  }, []);

  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
    justComposedRef.current = false;
    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
  }, []);

  const onCompositionEnd = useCallback(() => {
    composingRef.current = false;
    justComposedRef.current = true;
    releaseJustComposed();
  }, [releaseJustComposed]);

  const onKeyDown = useCallback((event: KeyboardEventLike) => {
    const native = event.nativeEvent as KeyboardEvent;
    const isImeCommit =
      composingRef.current ||
      justComposedRef.current ||
      native.isComposing ||
      native.keyCode === 229;

    if (event.key === 'Enter' && isImeCommit) {
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey && canSubmit) {
      event.preventDefault();
      onSubmit();
    }
  }, [canSubmit, onSubmit]);

  return {
    onCompositionStart,
    onCompositionEnd,
    onKeyDown,
  };
}
