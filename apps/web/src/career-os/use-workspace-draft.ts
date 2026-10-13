import { type SetStateAction, useEffect, useState } from "react";
import { subscribeToSessionBoundary } from "../api/client";
type Cell = { value: unknown; initial: unknown; disposed: boolean; listeners: Set<() => void> };
const cells = new Map<string, Cell>();
subscribeToSessionBoundary(() => {
  for (const cell of cells.values()) {
    cell.disposed = true;
    cell.value = cell.initial;
    for (const notify of cell.listeners) notify();
  }
  cells.clear();
});
/** Temporary task input survives in-app navigation, never an account change or a page reload. */
export function useWorkspaceDraft<T>(
  key: string,
  initial: T,
): [T, (next: SetStateAction<T>) => void] {
  const [, render] = useState(0);
  let existing = cells.get(key);
  if (!existing) {
    existing = { value: initial, initial, disposed: false, listeners: new Set() };
    cells.set(key, existing);
  }
  const cell = existing;
  useEffect(() => {
    const update = () => render((n) => n + 1);
    cell.listeners.add(update);
    return () => {
      cell.listeners.delete(update);
    };
  }, [cell]);
  return [
    cell.value as T,
    (next) => {
      if (cell.disposed) return;
      cell.value = typeof next === "function" ? (next as (old: T) => T)(cell.value as T) : next;
      for (const notify of cell.listeners) notify();
    },
  ];
}
export function resetWorkspaceDraft(key: string) {
  const cell = cells.get(key);
  if (!cell) return;
  cell.value = cell.initial;
  for (const notify of cell.listeners) notify();
}
