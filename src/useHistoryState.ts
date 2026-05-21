import { useCallback, useRef, useState } from 'react';

const COALESCE_MS = 500;
const MAX_HISTORY = 100;

export type HistoryControls = {
  undo: () => void;
  redo: () => void;
  // Set a new value and clear the history stack (e.g. loading a new file).
  replace: (value: unknown) => void;
  canUndo: boolean;
  canRedo: boolean;
};

export function useHistoryState<T>(initial: T | (() => T)) {
  const [present, setPresent] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const lastCommit = useRef(0);

  // A version counter forces re-render so canUndo/canRedo stay in sync.
  const [, bumpVersion] = useState(0);
  const bump = () => bumpVersion((v) => v + 1);

  const set = useCallback((next: T | ((prev: T) => T)) => {
    const now = Date.now();
    const shouldCommit = now - lastCommit.current > COALESCE_MS;
    lastCommit.current = now;
    setPresent((prev) => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      if (Object.is(value, prev)) return prev;
      if (shouldCommit) {
        // Dedup against the most recent past entry (StrictMode double-invoke
        // safety + cheap guard against identity-only changes).
        const top = past.current[past.current.length - 1];
        if (!Object.is(top, prev)) {
          const trimmed = past.current.slice(-(MAX_HISTORY - 1));
          past.current = [...trimmed, prev];
          future.current = [];
          bump();
        }
      }
      return value;
    });
  }, []);

  const undo = useCallback(() => {
    if (past.current.length === 0) return;
    setPresent((curr) => {
      const prev = past.current[past.current.length - 1];
      past.current = past.current.slice(0, -1);
      future.current = [...future.current, curr];
      lastCommit.current = 0;
      bump();
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    setPresent((curr) => {
      const next = future.current[future.current.length - 1];
      future.current = future.current.slice(0, -1);
      past.current = [...past.current, curr];
      lastCommit.current = 0;
      bump();
      return next;
    });
  }, []);

  const replace = useCallback((value: T) => {
    past.current = [];
    future.current = [];
    lastCommit.current = 0;
    bump();
    setPresent(value);
  }, []);

  const controls: HistoryControls = {
    undo,
    redo,
    replace: replace as (value: unknown) => void,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };

  return [present, set, controls] as const;
}
