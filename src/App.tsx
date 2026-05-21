import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type CSSProperties,
} from 'react';
import {
  defaultState,
  addCallout,
  newCallout,
  type Focus,
  type Caption,
  type Callout,
  type SpotlightState,
} from './types';
import { clamp, rgba, annotatedFilename } from './utils';
import { useDragPercent } from './useDragPercent';
import { useHistoryState } from './useHistoryState';
import { renderPng, downloadBlob } from './exportPng';

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode source image'));
    img.src = url;
  });
}

const canCopyImage = () =>
  typeof ClipboardItem !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  !!navigator.clipboard?.write;

const STORAGE_KEY = 'spotlight.v1';

type Dims = { w: number; h: number };

/* ---------- Focus rect with corner handles ---------- */
function FocusRect({
  callout,
  selected,
  onSelect,
  setFocus,
  imgRef,
  imgSrc,
  radius,
  shadow,
  zoomPct,
}: {
  callout: Callout;
  selected: boolean;
  onSelect: () => void;
  setFocus: (f: Focus) => void;
  imgRef: React.RefObject<HTMLImageElement>;
  imgSrc: string;
  radius: number;
  shadow: string;
  zoomPct: number;
}) {
  const { x, y, w, h } = callout.focus;
  const M = 1 + zoomPct / 100;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const imgLeftPct = ((cx * (1 - M) - x) / w) * 100;
  const imgTopPct = ((cy * (1 - M) - y) / h) * 100;
  const imgWidthPct = (M * 10000) / w;
  const imgHeightPct = (M * 10000) / h;

  const moveDrag = useDragPercent<Focus>(
    imgRef,
    (dx, dy, start) => {
      const nx = clamp(start.x + dx, 0, 100 - start.w);
      const ny = clamp(start.y + dy, 0, 100 - start.h);
      setFocus({ ...start, x: nx, y: ny });
    },
    () => callout.focus,
  );

  const corners: Array<{ id: 'nw' | 'ne' | 'sw' | 'se'; cur: string }> = [
    { id: 'nw', cur: 'nwse-resize' },
    { id: 'ne', cur: 'nesw-resize' },
    { id: 'sw', cur: 'nesw-resize' },
    { id: 'se', cur: 'nwse-resize' },
  ];

  const cornerDrag = {
    nw: useDragPercent<Focus>(
      imgRef,
      (dx, dy, start) => resize('nw', dx, dy, start, setFocus),
      () => callout.focus,
    ),
    ne: useDragPercent<Focus>(
      imgRef,
      (dx, dy, start) => resize('ne', dx, dy, start, setFocus),
      () => callout.focus,
    ),
    sw: useDragPercent<Focus>(
      imgRef,
      (dx, dy, start) => resize('sw', dx, dy, start, setFocus),
      () => callout.focus,
    ),
    se: useDragPercent<Focus>(
      imgRef,
      (dx, dy, start) => resize('se', dx, dy, start, setFocus),
      () => callout.focus,
    ),
  };

  const outline = selected
    ? '0 0 0 1.5px rgba(31, 26, 20, 0.6), 0 0 0 3px rgba(255,255,255,0.5)'
    : '0 0 0 1px rgba(31, 26, 20, 0.25)';

  return (
    <>
      {/* The crisp lens */}
      <div
        style={{
          position: 'absolute',
          left: `${x}%`,
          top: `${y}%`,
          width: `${w}%`,
          height: `${h}%`,
          overflow: 'hidden',
          borderRadius: radius,
          boxShadow: shadow,
        }}
      >
        <img
          src={imgSrc}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            width: `${imgWidthPct}%`,
            height: `${imgHeightPct}%`,
            left: `${imgLeftPct}%`,
            top: `${imgTopPct}%`,
            display: 'block',
            objectFit: 'cover',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* invisible body for dragging and selecting the whole rect */}
      <div
        {...moveDrag}
        onPointerDownCapture={onSelect}
        style={{
          position: 'absolute',
          left: `${x}%`,
          top: `${y}%`,
          width: `${w}%`,
          height: `${h}%`,
          cursor: 'move',
          borderRadius: radius,
          boxShadow: outline,
        }}
      />

      {/* corner handles — only when selected */}
      {selected &&
        corners.map((c) => {
          const isE = c.id.includes('e');
          const isS = c.id.includes('s');
          return (
            <div
              key={c.id}
              {...cornerDrag[c.id]}
              style={{
                position: 'absolute',
                width: 14,
                height: 14,
                left: `${isE ? x + w : x}%`,
                top: `${isS ? y + h : y}%`,
                transform: 'translate(-50%, -50%)',
                background: '#fff',
                border: '1.5px solid #1f1a14',
                borderRadius: 3,
                cursor: c.cur,
                boxShadow: '0 1px 2px rgba(0,0,0,.2)',
              }}
            />
          );
        })}
    </>
  );
}

function resize(
  id: 'nw' | 'ne' | 'sw' | 'se',
  dx: number,
  dy: number,
  start: Focus,
  setFocus: (f: Focus) => void,
) {
  let { x, y, w, h } = start;
  const minSize = 4;
  if (id.includes('w')) {
    const nx = clamp(x + dx, 0, x + w - minSize);
    w -= nx - x;
    x = nx;
  }
  if (id.includes('e')) {
    w = clamp(w + dx, minSize, 100 - x);
  }
  if (id.includes('n')) {
    const ny = clamp(y + dy, 0, y + h - minSize);
    h -= ny - y;
    y = ny;
  }
  if (id.includes('s')) {
    h = clamp(h + dy, minSize, 100 - y);
  }
  setFocus({ x, y, w, h });
}

/* ---------- Caption block (drag + inline edit) ---------- */
function CaptionBlock({
  callout,
  selected,
  onSelect,
  setCaption,
  setTitle,
  setBody,
  imgRef,
}: {
  callout: Callout;
  selected: boolean;
  onSelect: () => void;
  setCaption: (c: Caption) => void;
  setTitle: (s: string) => void;
  setBody: (s: string) => void;
  imgRef: React.RefObject<HTMLImageElement>;
}) {
  const [editing, setEditing] = useState<'title' | 'body' | null>(null);
  const dragHeader = useDragPercent<Caption>(
    imgRef,
    (dx, dy, start) => {
      const nx = clamp(start.x + dx, 0, 100 - 6);
      const ny = clamp(start.y + dy, 0, 100 - 4);
      setCaption({ ...start, x: nx, y: ny });
    },
    () => callout.caption,
  );

  return (
    <div
      style={{
        position: 'absolute',
        left: `${callout.caption.x}%`,
        top: `${callout.caption.y}%`,
        width: `${callout.caption.w}%`,
        color: '#1f1a14',
      }}
      onPointerDownCapture={onSelect}
    >
      <div
        className="caption-handle"
        {...dragHeader}
        style={{
          position: 'absolute',
          left: 0,
          top: -28,
          height: 24,
          padding: '2px 8px',
          background: '#1f1a14',
          color: '#fff',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '.08em',
          borderRadius: 4,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'move',
          opacity: selected ? undefined : 0,
          transition: 'opacity .12s ease',
          userSelect: 'none',
          pointerEvents: selected ? 'auto' : 'none',
        }}
      >
        <span style={{ fontSize: 10 }}>⠿</span> DRAG
      </div>

      <div
        contentEditable
        suppressContentEditableWarning
        onFocus={() => setEditing('title')}
        onBlur={(e) => {
          setTitle(e.currentTarget.textContent ?? '');
          setEditing(null);
        }}
        spellCheck={false}
        style={{
          fontSize: 'clamp(14px, 1.3vw, 22px)',
          letterSpacing: '.22em',
          textTransform: 'uppercase',
          fontWeight: 600,
          marginBottom: '1em',
          color: callout.headlineColor,
          outline: editing === 'title' ? '2px solid #c8d4f7' : 'none',
          outlineOffset: 4,
          borderRadius: 2,
          cursor: 'text',
        }}
      >
        {callout.title}
      </div>

      <div
        contentEditable
        suppressContentEditableWarning
        onFocus={() => setEditing('body')}
        onBlur={(e) => {
          setBody(e.currentTarget.textContent ?? '');
          setEditing(null);
        }}
        spellCheck={false}
        style={{
          fontSize: 'clamp(20px, 2vw, 34px)',
          lineHeight: 1.35,
          fontWeight: 400,
          outline: editing === 'body' ? '2px solid #c8d4f7' : 'none',
          outlineOffset: 4,
          borderRadius: 2,
          cursor: 'text',
        }}
      >
        {callout.body}
      </div>
    </div>
  );
}

/* ---------- Right-side style panel ---------- */
type Setter = <K extends keyof SpotlightState>(
  key: K,
  value: SpotlightState[K],
) => void;

function StylePanel({
  s,
  set,
  onReset,
  onExport,
  onCopy,
  onAddCallout,
  onSelectCallout,
  onDeleteCallout,
  onSetSelectedHeadlineColor,
  srcName,
  exporting,
  copying,
  copied,
}: {
  s: SpotlightState;
  set: Setter;
  onReset: () => void;
  onExport: () => void;
  onCopy: () => void;
  onAddCallout: () => void;
  onSelectCallout: (id: string) => void;
  onDeleteCallout: (id: string) => void;
  onSetSelectedHeadlineColor: (c: string) => void;
  srcName: string | null;
  exporting: boolean;
  copying: boolean;
  copied: boolean;
}) {
  const rowStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 14,
  };
  const labelRow: CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    color: '#6b6358',
  };
  const sectionStyle: CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    color: '#9c8f7a',
    padding: '16px 0 8px',
    borderTop: '1px solid #ebe3d0',
    marginTop: 8,
  };

  const Row = ({
    label,
    value,
    children,
  }: {
    label: string;
    value: string;
    children: React.ReactNode;
  }) => (
    <div style={rowStyle}>
      <div style={labelRow}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </div>
      {children}
    </div>
  );

  const Swatches = <K extends keyof SpotlightState>({
    k,
    opts,
  }: {
    k: K;
    opts: string[];
  }) => (
    <div style={{ display: 'flex', gap: 6 }}>
      {opts.map((o) => (
        <button
          key={o}
          onClick={() => set(k, o as SpotlightState[K])}
          aria-label={o}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: s[k] === o ? '2px solid #1f1a14' : '1px solid #d6c9aa',
            background: o,
            cursor: 'pointer',
            padding: 0,
            boxShadow: s[k] === o ? '0 0 0 2px #fff inset' : 'none',
          }}
        />
      ))}
    </div>
  );

  const selected = s.callouts.find((c) => c.id === s.selectedId) ?? null;

  return (
    <aside
      style={{
        width: 320,
        flex: '0 0 auto',
        background: '#fbf6ea',
        borderLeft: '1px solid #ebe3d0',
        padding: '20px 22px',
        overflowY: 'auto',
        boxSizing: 'border-box',
        color: '#1f1a14',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 18,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 15 }}>Settings</div>
        <button
          onClick={onReset}
          style={{
            background: 'transparent',
            border: 0,
            color: '#6b6358',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
      </div>

      <div style={{ ...sectionStyle, borderTop: 0, marginTop: 0, paddingTop: 0 }}>
        Callouts
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        {s.callouts.map((c, i) => {
          const isSelected = c.id === s.selectedId;
          return (
            <div
              key={c.id}
              onClick={() => onSelectCallout(c.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 4,
                background: isSelected ? '#ebe3d0' : 'transparent',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: c.headlineColor,
                  flex: '0 0 auto',
                  border: '1px solid rgba(0,0,0,0.1)',
                }}
              />
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: '#1f1a14',
                }}
              >
                {c.title || `Callout ${i + 1}`}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteCallout(c.id);
                }}
                disabled={s.callouts.length === 1}
                title={s.callouts.length === 1 ? 'At least one callout required' : 'Delete'}
                style={{
                  background: 'transparent',
                  border: 0,
                  color: s.callouts.length === 1 ? '#d6c9aa' : '#6b6358',
                  cursor: s.callouts.length === 1 ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  padding: '0 4px',
                  lineHeight: 1,
                }}
                aria-label="Delete callout"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={onAddCallout}
        style={{
          width: '100%',
          background: 'transparent',
          border: '1px dashed #d6c9aa',
          color: '#1f1a14',
          padding: '6px 10px',
          borderRadius: 5,
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        + Add callout
      </button>

      <div style={sectionStyle}>Focus</div>
      <Row label="Backdrop blur" value={`${s.blurPx}px`}>
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={s.blurPx}
          onChange={(e) => set('blurPx', parseFloat(e.target.value))}
        />
      </Row>
      <Row label="Lightness" value={s.scrimAlpha.toFixed(2)}>
        <input
          type="range"
          min={0}
          max={0.95}
          step={0.01}
          value={s.scrimAlpha}
          onChange={(e) => set('scrimAlpha', parseFloat(e.target.value))}
        />
      </Row>
      <Row label="Tint" value="">
        <Swatches
          k="scrimColor"
          opts={['#ffffff', '#fcf6e9', '#f3ebd6', '#e6f0f4', '#1a1612']}
        />
      </Row>

      <div style={sectionStyle}>Focus shadow</div>
      <Row label="Size" value={`${s.shadowSize}px`}>
        <input
          type="range"
          min={0}
          max={60}
          step={1}
          value={s.shadowSize}
          onChange={(e) => set('shadowSize', parseFloat(e.target.value))}
        />
      </Row>
      <Row label="Depth" value={String(s.shadowDepth)}>
        <input
          type="range"
          min={0}
          max={60}
          step={1}
          value={s.shadowDepth}
          onChange={(e) => set('shadowDepth', parseFloat(e.target.value))}
        />
      </Row>
      <Row label="Corner radius" value={`${s.lensRadius}px`}>
        <input
          type="range"
          min={0}
          max={40}
          step={1}
          value={s.lensRadius}
          onChange={(e) => set('lensRadius', parseFloat(e.target.value))}
        />
      </Row>
      <Row label="Magnification" value={`+${Math.round(s.lensZoom)}%`}>
        <input
          type="range"
          min={0}
          max={200}
          step={1}
          value={s.lensZoom}
          onChange={(e) => set('lensZoom', parseFloat(e.target.value))}
        />
      </Row>

      <div style={sectionStyle}>
        {selected ? 'Selected callout' : 'Text'}
      </div>
      <Row
        label={selected ? 'Headline color' : 'Headline color (select a callout)'}
        value=""
      >
        <div style={{ display: 'flex', gap: 6, opacity: selected ? 1 : 0.4 }}>
          {['#c04a2b', '#d97757', '#1f1a14', '#a06a3c', '#2d5a8f', '#5c8a4a'].map(
            (o) => (
              <button
                key={o}
                disabled={!selected}
                onClick={() => onSetSelectedHeadlineColor(o)}
                aria-label={o}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  border:
                    selected?.headlineColor === o
                      ? '2px solid #1f1a14'
                      : '1px solid #d6c9aa',
                  background: o,
                  cursor: selected ? 'pointer' : 'not-allowed',
                  padding: 0,
                  boxShadow:
                    selected?.headlineColor === o ? '0 0 0 2px #fff inset' : 'none',
                }}
              />
            ),
          )}
        </div>
      </Row>

      <div style={sectionStyle}>Export</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onExport}
          disabled={exporting}
          style={{
            flex: 1,
            background: exporting ? '#6b6358' : '#1f1a14',
            color: '#fff',
            border: 0,
            borderRadius: 6,
            padding: '10px 12px',
            fontSize: 13,
            fontWeight: 600,
            cursor: exporting ? 'wait' : 'pointer',
            letterSpacing: '.01em',
          }}
        >
          {exporting ? 'Exporting…' : 'Export PNG'}
        </button>
        <button
          onClick={onCopy}
          disabled={copying}
          title="Copy PNG to clipboard"
          style={{
            flex: '0 0 auto',
            background: copied ? '#5c8a4a' : 'transparent',
            color: copied ? '#fff' : '#1f1a14',
            border: copied ? '0' : '1px solid #d6c9aa',
            borderRadius: 6,
            padding: '10px 12px',
            fontSize: 13,
            fontWeight: 600,
            cursor: copying ? 'wait' : 'pointer',
            letterSpacing: '.01em',
            transition: 'background .15s ease, color .15s ease',
            minWidth: 90,
          }}
        >
          {copied ? 'Copied!' : copying ? 'Copying…' : 'Copy'}
        </button>
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          color: '#9c8f7a',
          lineHeight: 1.45,
        }}
      >
        Saves a flattened PNG at the original screenshot resolution. Drop into a
        README with{' '}
        <code
          style={{
            background: '#ebe3d0',
            padding: '1px 4px',
            borderRadius: 3,
          }}
        >
          ![](…)
        </code>
        , or paste straight into a GitHub comment with Copy.
      </div>

      {srcName && (
        <div
          style={{
            marginTop: 18,
            padding: '8px 10px',
            background: '#ebe3d0',
            borderRadius: 6,
            fontSize: 11,
            color: '#6b6358',
            wordBreak: 'break-all',
          }}
        >
          {srcName}
        </div>
      )}
    </aside>
  );
}

/* ---------- Top bar ---------- */
function TopBar({
  srcName,
  hasImage,
  onReplace,
}: {
  srcName: string | null;
  hasImage: boolean;
  onReplace: () => void;
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '10px 20px',
        background: '#fbf6ea',
        borderBottom: '1px solid #ebe3d0',
        fontSize: 13,
        color: '#1f1a14',
        flex: '0 0 auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600 }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: 'linear-gradient(135deg,#c04a2b,#d97757)',
            boxShadow:
              'inset 0 0 0 1px rgba(255,255,255,.5), 0 1px 3px rgba(192,74,43,.3)',
          }}
        />
        Spotlight
      </div>
      <span style={{ color: '#d6c9aa' }}>/</span>
      <span style={{ color: '#6b6358' }}>{srcName ?? 'Untitled'}</span>
      <div style={{ flex: 1 }} />
      {hasImage && (
        <button
          onClick={onReplace}
          style={{
            background: 'transparent',
            border: '1px solid #d6c9aa',
            color: '#1f1a14',
            padding: '5px 10px',
            borderRadius: 5,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Replace screenshot
        </button>
      )}
    </header>
  );
}

/* ---------- Empty / upload state ---------- */
function UploadZone({ onFile }: { onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f && f.type.startsWith('image/')) onFile(f);
      }}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: over ? '#f1e8d4' : '#f6efe1',
        transition: 'background .15s ease',
      }}
    >
      <div
        style={{
          width: 460,
          maxWidth: '85%',
          border: `2px dashed ${over ? '#c04a2b' : '#d6c9aa'}`,
          borderRadius: 12,
          padding: '48px 32px',
          textAlign: 'center',
          background: over ? 'rgba(255,255,255,.6)' : '#fff',
          transition: 'all .15s ease',
          cursor: 'pointer',
        }}
        onClick={() => fileRef.current?.click()}
      >
        <div
          style={{
            width: 56,
            height: 56,
            margin: '0 auto 18px',
            borderRadius: 14,
            background: '#f1e8d4',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#c04a2b"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="9" cy="9" r="2" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: '#1f1a14',
            marginBottom: 6,
          }}
        >
          Drop a screenshot
        </div>
        <div style={{ fontSize: 14, color: '#6b6358', marginBottom: 18 }}>
          Drop a file, browse, or paste with ⌘V. PNG transparency is
          preserved.
        </div>
        <button
          style={{
            background: '#1f1a14',
            color: '#fff',
            border: 0,
            padding: '8px 18px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Browse files…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}

/* ---------- Single callout's editable layer ---------- */
function CalloutLayer({
  callout,
  selected,
  onSelect,
  setCallout,
  imgRef,
  imgSrc,
  radius,
  shadow,
  zoomPct,
}: {
  callout: Callout;
  selected: boolean;
  onSelect: () => void;
  setCallout: (partial: Partial<Callout>) => void;
  imgRef: React.RefObject<HTMLImageElement>;
  imgSrc: string;
  radius: number;
  shadow: string;
  zoomPct: number;
}) {
  return (
    <>
      <FocusRect
        callout={callout}
        selected={selected}
        onSelect={onSelect}
        setFocus={(f) => setCallout({ focus: f })}
        imgRef={imgRef}
        imgSrc={imgSrc}
        radius={radius}
        shadow={shadow}
        zoomPct={zoomPct}
      />
      <CaptionBlock
        callout={callout}
        selected={selected}
        onSelect={onSelect}
        setCaption={(c) => setCallout({ caption: c })}
        setTitle={(t) => setCallout({ title: t })}
        setBody={(b) => setCallout({ body: b })}
        imgRef={imgRef}
      />
    </>
  );
}

/* ---------- Main editor stage ---------- */
function EditorStage({
  imgSrc,
  imgDims,
  state,
  set,
  setCallout,
  selectCallout,
  imgRef,
}: {
  imgSrc: string;
  imgDims: Dims | null;
  state: SpotlightState;
  set: Setter;
  setCallout: (id: string, partial: Partial<Callout>) => void;
  selectCallout: (id: string | null) => void;
  imgRef: React.RefObject<HTMLImageElement>;
}) {
  const sBlur = Math.round(state.shadowSize * 0.9);
  const sY = Math.round(state.shadowDepth * 0.45);
  const sAlpha = Math.min(0.75, 0.18 + state.shadowDepth / 180);
  const shadow = `0 ${sY}px ${sBlur}px 0 rgba(20,14,8,${sAlpha.toFixed(
    3,
  )}), 0 0 0 1px rgba(255,255,255,.5) inset`;

  const aspect = imgDims ? `${imgDims.w} / ${imgDims.h}` : '16 / 9';

  // Used by the consumer of `set` for global keys; cast is safe because we
  // never call this for nested callout keys.
  void set;

  return (
    <div
      style={{
        flex: 1,
        background: '#e7dec5',
        padding: 40,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
      }}
      onPointerDown={(e) => {
        // Deselect when clicking on empty stage background.
        if (e.target === e.currentTarget) selectCallout(null);
      }}
    >
      <div
        style={{
          position: 'relative',
          maxWidth: '100%',
          maxHeight: '100%',
          aspectRatio: aspect,
          borderRadius: 4,
          boxShadow: '0 8px 30px -10px rgba(0,0,0,.2)',
        }}
      >
        <img
          ref={imgRef}
          src={imgSrc}
          alt="screenshot"
          draggable={false}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            borderRadius: 4,
            objectFit: 'fill',
          }}
        />
        {/* lighten + blur scrim */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 4,
            background: rgba(state.scrimColor, state.scrimAlpha),
            backdropFilter: `blur(${state.blurPx}px) saturate(0.9)`,
            WebkitBackdropFilter: `blur(${state.blurPx}px) saturate(0.9)`,
            pointerEvents: 'none',
          }}
        />
        <div
          style={{ position: 'absolute', inset: 0 }}
          className="annot-layer"
          onPointerDown={(e) => {
            // Clicking inside the annotation layer but not on a callout
            // also deselects.
            if (e.target === e.currentTarget) selectCallout(null);
          }}
        >
          {state.callouts.map((c) => (
            <CalloutLayer
              key={c.id}
              callout={c}
              selected={c.id === state.selectedId}
              onSelect={() => selectCallout(c.id)}
              setCallout={(partial) => setCallout(c.id, partial)}
              imgRef={imgRef}
              imgSrc={imgSrc}
              radius={state.lensRadius}
              shadow={shadow}
              zoomPct={state.lensZoom}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Persistence ---------- */
type Persisted = {
  src: string | null;
  srcName: string | null;
  dims: Dims | null;
  state: SpotlightState;
};

// Old shape (pre-multi-callout): single focus/caption/title/body/headlineColor
// flat on state. Convert to a single callout to preserve user work.
type LegacyState = Partial<SpotlightState> & {
  focus?: Focus;
  caption?: Caption;
  title?: string;
  body?: string;
  headlineColor?: string;
};

function migrateState(raw: unknown): SpotlightState {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as LegacyState;
  if (Array.isArray(r.callouts) && r.callouts.length > 0) {
    return { ...base, ...(r as Partial<SpotlightState>) } as SpotlightState;
  }
  if (r.focus) {
    const c = newCallout({
      focus: r.focus,
      caption: r.caption ?? base.callouts[0].caption,
      title: r.title ?? base.callouts[0].title,
      body: r.body ?? base.callouts[0].body,
      headlineColor: r.headlineColor ?? base.callouts[0].headlineColor,
    });
    return {
      ...base,
      ...(r as Partial<SpotlightState>),
      callouts: [c],
      selectedId: c.id,
    };
  }
  return base;
}

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Persisted;
    p.state = migrateState(p.state);
    return p;
  } catch {
    return null;
  }
}

function savePersisted(p: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Quota / serialization issue — too-large image is the likely cause;
    // user can reload it.
  }
}

/* ---------- Root ---------- */
export function App() {
  const persisted = useMemo(() => loadPersisted(), []);
  const [src, setSrc] = useState<string | null>(persisted?.src ?? null);
  const [srcName, setSrcName] = useState<string | null>(persisted?.srcName ?? null);
  const [dims, setDims] = useState<Dims | null>(persisted?.dims ?? null);
  const [state, setState, history] = useHistoryState<SpotlightState>(
    () => persisted?.state ?? defaultState(),
  );
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    savePersisted({ src, srcName, dims, state });
  }, [src, srcName, dims, state]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable =
        !!target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA');

      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      // Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z always handled at the app level,
      // even inside text editing — contentEditable's native undo doesn't
      // capture our state changes anyway.
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        history.redo();
        return;
      }

      if (inEditable) return;

      if (e.key === 'Escape') {
        (document.activeElement as HTMLElement | null)?.blur?.();
        setState((s) => (s.selectedId === null ? s : { ...s, selectedId: null }));
        return;
      }

      const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (arrows.includes(e.key)) {
        const step = e.shiftKey ? 5 : 1;
        const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        let handled = false;
        setState((s) => {
          if (!s.selectedId) return s;
          handled = true;
          return {
            ...s,
            callouts: s.callouts.map((c) =>
              c.id === s.selectedId
                ? {
                    ...c,
                    focus: {
                      ...c.focus,
                      x: clamp(c.focus.x + dx, 0, 100 - c.focus.w),
                      y: clamp(c.focus.y + dy, 0, 100 - c.focus.h),
                    },
                  }
                : c,
            ),
          };
        });
        if (handled) e.preventDefault();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        let handled = false;
        setState((s) => {
          if (!s.selectedId || s.callouts.length === 1) return s;
          handled = true;
          const next = s.callouts.filter((c) => c.id !== s.selectedId);
          return { ...s, callouts: next, selectedId: next[0].id };
        });
        if (handled) e.preventDefault();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [history, setState]);

  const set: Setter = useCallback((key, value) => {
    setState((s) => ({ ...s, [key]: value }));
  }, []);

  const setCallout = useCallback((id: string, partial: Partial<Callout>) => {
    setState((s) => ({
      ...s,
      callouts: s.callouts.map((c) => (c.id === id ? { ...c, ...partial } : c)),
    }));
  }, []);

  const selectCallout = useCallback((id: string | null) => {
    setState((s) => (s.selectedId === id ? s : { ...s, selectedId: id }));
  }, []);

  const onAddCallout = useCallback(() => {
    setState((s) => addCallout(s));
  }, []);

  const onDeleteCallout = useCallback((id: string) => {
    setState((s) => {
      if (s.callouts.length === 1) return s;
      const next = s.callouts.filter((c) => c.id !== id);
      return {
        ...s,
        callouts: next,
        selectedId: s.selectedId === id ? next[0].id : s.selectedId,
      };
    });
  }, []);

  const onSetSelectedHeadlineColor = useCallback(
    (color: string) => {
      setState((s) => {
        if (!s.selectedId) return s;
        return {
          ...s,
          callouts: s.callouts.map((c) =>
            c.id === s.selectedId ? { ...c, headlineColor: color } : c,
          ),
        };
      });
    },
    [],
  );

  const onFile = useCallback(
    (f: File) => {
      setSrcName(f.name || 'pasted.png');
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        const img = new Image();
        img.onload = () => {
          setDims({ w: img.naturalWidth, h: img.naturalHeight });
          setSrc(url);
          // A new image is a fresh editing context — drop the old undo stack.
          history.replace(defaultState());
        };
        img.src = url;
      };
      reader.readAsDataURL(f);
    },
    [history],
  );

  // Paste an image from the clipboard at any time. Skipped if focus is in
  // a text field (so ⌘V in a contentEditable still does the usual thing).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA')
      ) {
        return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            onFile(file);
          }
          return;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFile]);

  const onExport = async () => {
    if (!imgRef.current || !src) return;
    setExporting(true);
    try {
      const decoded = await decodeImage(src);
      const stageWidth = imgRef.current.getBoundingClientRect().width;
      const blob = await renderPng(decoded, state, stageWidth);
      downloadBlob(blob, annotatedFilename(srcName));
    } catch (err) {
      console.error(err);
      alert('Export failed: ' + (err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  // Build the blob promise synchronously inside the click handler so Safari
  // accepts `new ClipboardItem({ 'image/png': promise })` — Safari requires
  // the ClipboardItem be constructed in the same user-gesture task.
  const onCopy = () => {
    if (!imgRef.current || !src) return;
    const stageWidth = imgRef.current.getBoundingClientRect().width;
    const blobPromise = decodeImage(src).then((decoded) =>
      renderPng(decoded, state, stageWidth),
    );

    if (!canCopyImage()) {
      setCopying(true);
      blobPromise
        .then((blob) => downloadBlob(blob, annotatedFilename(srcName)))
        .catch((err) => alert('Copy failed: ' + (err as Error).message))
        .finally(() => setCopying(false));
      return;
    }

    setCopying(true);
    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': blobPromise })])
      .then(() => setCopied(true))
      .catch((err) => {
        console.error(err);
        alert('Copy failed: ' + (err as Error).message);
      })
      .finally(() => setCopying(false));
  };

  const onReplace = () => {
    setSrc(null);
    setSrcName(null);
    setDims(null);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#f6efe1',
      }}
    >
      <TopBar srcName={srcName} hasImage={!!src} onReplace={onReplace} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {src ? (
          <>
            <EditorStage
              imgSrc={src}
              imgDims={dims}
              state={state}
              set={set}
              setCallout={setCallout}
              selectCallout={selectCallout}
              imgRef={imgRef}
            />
            <StylePanel
              s={state}
              set={set}
              onReset={() => setState(defaultState())}
              onExport={onExport}
              onCopy={onCopy}
              onAddCallout={onAddCallout}
              onSelectCallout={selectCallout}
              onDeleteCallout={onDeleteCallout}
              onSetSelectedHeadlineColor={onSetSelectedHeadlineColor}
              srcName={srcName}
              exporting={exporting}
              copying={copying}
              copied={copied}
            />
          </>
        ) : (
          <UploadZone onFile={onFile} />
        )}
      </div>
    </div>
  );
}
