import { useRef } from 'react';

type Start<T> = T;

export function useDragPercent<T>(
  imgRef: React.RefObject<HTMLElement>,
  onChange: (dx: number, dy: number, start: Start<T>) => void,
  getStart: () => Start<T>,
) {
  const stateRef = useRef<{
    rect: DOMRect;
    startClientX: number;
    startClientY: number;
    start: Start<T>;
  } | null>(null);

  const onMove = (e: PointerEvent) => {
    const s = stateRef.current;
    if (!s) return;
    const dx = ((e.clientX - s.startClientX) / s.rect.width) * 100;
    const dy = ((e.clientY - s.startClientY) / s.rect.height) * 100;
    onChange(dx, dy, s.start);
  };

  const onUp = () => {
    stateRef.current = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    stateRef.current = {
      rect,
      startClientX: e.clientX,
      startClientY: e.clientY,
      start: getStart(),
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return { onPointerDown };
}
