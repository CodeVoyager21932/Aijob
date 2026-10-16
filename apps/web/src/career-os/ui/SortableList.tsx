import { type ReactNode, useRef, useState } from "react";

/** One ordering interaction for outlines and entries. Arrow buttons also work without dragging. */
export function SortableList<T extends { id: string }>({
  items,
  label,
  name,
  move,
  children,
}: {
  items: T[];
  label: string;
  name: (item: T) => string;
  move: (from: number, to: number) => void;
  children: (item: T, index: number) => ReactNode;
}) {
  const list = useRef<HTMLOListElement>(null);
  const pointer = useRef<{
    id: string;
    from: number;
    target: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const reorder = (from: number, to: number) => {
    const item = items[from];
    if (!item || from === to || to < 0 || to >= items.length) return;
    move(from, to);
    setAnnouncement(`${name(item)}已移到第 ${to + 1} 位`);
  };
  return (
    <>
      <ol ref={list} className="ui-sortable-list" aria-label={label}>
        {items.map((item, index) => (
          <li
            key={item.id}
            data-drop-target={over === item.id && dragged !== item.id}
            data-sortable-id={item.id}
            data-dragging={dragged === item.id}
          >
            <div className="ui-sortable-controls">
              <button
                type="button"
                className="ui-drag-handle"
                title={`拖动调整${name(item)}的顺序`}
                aria-label={`拖动${name(item)}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  pointer.current = {
                    id: item.id,
                    from: index,
                    target: index,
                    x: event.clientX,
                    y: event.clientY,
                    moved: false,
                  };
                }}
                onPointerMove={(event) => {
                  const drag = pointer.current;
                  if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5)
                    return;
                  drag.moved = true;
                  setDragged(drag.id);
                  const target = window.document
                    .elementFromPoint(event.clientX, event.clientY)
                    ?.closest<HTMLElement>("[data-sortable-id]");
                  if (target?.parentElement === list.current) {
                    const next = items.findIndex((value) => value.id === target.dataset.sortableId);
                    if (next >= 0) {
                      drag.target = next;
                      setOver(items[next]?.id ?? null);
                    }
                  }
                  const scroll = list.current?.closest<HTMLElement>(
                    ".native-form, .native-outline",
                  );
                  const bounds = scroll?.getBoundingClientRect();
                  if (scroll && bounds) {
                    if (event.clientY < bounds.top + 30) scroll.scrollTop -= 18;
                    else if (event.clientY > bounds.bottom - 30) scroll.scrollTop += 18;
                  }
                }}
                onPointerUp={(event) => {
                  const drag = pointer.current;
                  pointer.current = null;
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  if (drag?.moved) reorder(drag.from, drag.target);
                  setDragged(null);
                  setOver(null);
                }}
                onPointerCancel={() => {
                  pointer.current = null;
                  setDragged(null);
                  setOver(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    reorder(index, index + (event.key === "ArrowUp" ? -1 : 1));
                  }
                }}
              >
                ⠿
              </button>
              <button
                type="button"
                disabled={index === 0}
                aria-label={`${name(item)}上移`}
                onClick={() => reorder(index, index - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === items.length - 1}
                aria-label={`${name(item)}下移`}
                onClick={() => reorder(index, index + 1)}
              >
                ↓
              </button>
            </div>
            {children(item, index)}
          </li>
        ))}
      </ol>
      <output className="sr-only">{announcement}</output>
    </>
  );
}
