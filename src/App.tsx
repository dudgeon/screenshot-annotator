import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type CSSProperties,
} from 'react';
import { DEFAULTS, type Focus, type Caption, type SpotlightState } from './types';
import { clamp, rgba, annotatedFilename } from './utils';
import { useDragPercent } from './useDragPercent';
import { exportPng } from './exportPng';

const STORAGE_KEY = 'spotlight.v1';

type Dims = { w: number; h: number };

/* ---------- Focus rect with corner handles ---------- */
function FocusRect({
  focus,
  setFocus,
  imgRef,
  imgSrc,
  radius,
  shadow,
  zoomPct,
}: {
  focus: Focus;
  setFocus: (f: Focus) => void;
  imgRef: React.RefObject<HTMLImageElement>;
  imgSrc: string;
  radius: number;
  shadow: string;
  zoomPct: number;
}) {
  const { x, y, w, h } = focus;
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
    () => focus,
  );

  const corners: Array<{ id: 'nw' | 'ne' | 'sw' | 'se'; cur: string }> = [
    { id: 'nw', cur: 'nwse-resize' },
    { id: 'ne', cur: 'nesw-resize' },
    { id: 'sw', cur: 'nesw-resize' },
    { id: 'se', cur: 'nwse-resize' },
  ];

  // Build a drag handler per-corner. useDragPercent uses refs internally, so
  // it's safe to call once per render per corner — the corner set is fixed.
  const cornerDrag = {
    nw: useDragPercent<Focus>(
      imgRef,
      (dx, dy, start) => resize('nw', dx, dy, start, setFocus),
      () => focus,
    ),
    ne: useDragPercent<Focus>(
      imgRef,
      (dx, dy, start) => resize('ne', dx, dy, start, setFocus),
      () => focus,
    ),
    sw: useDragPercent<Focus>(
      imgRef,
      (dx, dy, start) => resize('sw', dx, dy, start, setFocus),
      () => focus,
    ),
    se: useDragPercent<Focus>(
      imgRef,
      (dx, dy, start) => resize('se', dx, dy, start, setFocus),
      () => focus,
    ),
  };

  return (
    <>
      {/* The crisp lens — same compositing as the README preview */}
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

      {/* invisible body for dragging the whole rect */}
      <div
        {...moveDrag}
        style={{
          position: 'absolute',
          left: `${x}%`,
          top: `${y}%`,
          width: `${w}%`,
          height: `${h}%`,
          cursor: 'move',
          borderRadius: radius,
          boxShadow:
            '0 0 0 1.5px rgba(31, 26, 20, 0.6), 0 0 0 3px rgba(255,255,255,0.5)',
        }}
      />

      {/* corner handles — positioned with absolute %, not margin% */}
      {corners.map((c) => {
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
  caption,
  setCaption,
  title,
  setTitle,
  body,
  setBody,
  headlineColor,
  imgRef,
}: {
  caption: Caption;
  setCaption: (c: Caption) => void;
  title: string;
  setTitle: (s: string) => void;
  body: string;
  setBody: (s: string) => void;
  headlineColor: string;
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
    () => caption,
  );

  return (
    <div
      style={{
        position: 'absolute',
        left: `${caption.x}%`,
        top: `${caption.y}%`,
        width: `${caption.w}%`,
        color: '#1f1a14',
      }}
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
          opacity: 0,
          transition: 'opacity .12s ease',
          userSelect: 'none',
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
          color: headlineColor,
          outline: editing === 'title' ? '2px solid #c8d4f7' : 'none',
          outlineOffset: 4,
          borderRadius: 2,
          cursor: 'text',
        }}
      >
        {title}
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
        {body}
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
  srcName,
  exporting,
}: {
  s: SpotlightState;
  set: Setter;
  onReset: () => void;
  onExport: () => void;
  srcName: string | null;
  exporting: boolean;
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

      <div style={sectionStyle}>Text</div>
      <Row label="Headline color" value="">
        <Swatches
          k="headlineColor"
          opts={['#c04a2b', '#d97757', '#1f1a14', '#a06a3c', '#2d5a8f', '#5c8a4a']}
        />
      </Row>

      <div style={sectionStyle}>Export</div>
      <button
        onClick={onExport}
        disabled={exporting}
        style={{
          width: '100%',
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
        .
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
          PNG or JPEG, any size. We'll keep it sharp.
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

/* ---------- Main editor stage ---------- */
function EditorStage({
  imgSrc,
  imgDims,
  state,
  set,
  imgRef,
}: {
  imgSrc: string;
  imgDims: Dims | null;
  state: SpotlightState;
  set: Setter;
  imgRef: React.RefObject<HTMLImageElement>;
}) {
  const sBlur = Math.round(state.shadowSize * 0.9);
  const sY = Math.round(state.shadowDepth * 0.45);
  const sAlpha = Math.min(0.75, 0.18 + state.shadowDepth / 180);
  const shadow = `0 ${sY}px ${sBlur}px 0 rgba(20,14,8,${sAlpha.toFixed(
    3,
  )}), 0 0 0 1px rgba(255,255,255,.5) inset`;

  const aspect = imgDims ? `${imgDims.w} / ${imgDims.h}` : '16 / 9';

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
        >
          <FocusRect
            focus={state.focus}
            setFocus={(f) => set('focus', f)}
            imgRef={imgRef}
            imgSrc={imgSrc}
            radius={state.lensRadius}
            shadow={shadow}
            zoomPct={state.lensZoom}
          />
          <CaptionBlock
            caption={state.caption}
            setCaption={(c) => set('caption', c)}
            title={state.title}
            setTitle={(v) => set('title', v)}
            body={state.body}
            setBody={(v) => set('body', v)}
            headlineColor={state.headlineColor}
            imgRef={imgRef}
          />
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

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Persisted;
    // Backfill any missing keys (forward-compatible).
    p.state = { ...DEFAULTS, ...p.state };
    return p;
  } catch {
    return null;
  }
}

function savePersisted(p: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Quota or serialization issue — fail silently; a too-large image is the
    // most likely cause, and the user can reload it on demand.
  }
}

/* ---------- Root ---------- */
export function App() {
  const [src, setSrc] = useState<string | null>(null);
  const [srcName, setSrcName] = useState<string | null>(null);
  const [dims, setDims] = useState<Dims | null>(null);
  const [state, setState] = useState<SpotlightState>(DEFAULTS);
  const [exporting, setExporting] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    const p = loadPersisted();
    if (!p) return;
    setSrc(p.src);
    setSrcName(p.srcName);
    setDims(p.dims);
    setState(p.state);
  }, []);

  // Persist on every change.
  useEffect(() => {
    savePersisted({ src, srcName, dims, state });
  }, [src, srcName, dims, state]);

  const set: Setter = useCallback((key, value) => {
    setState((s) => ({ ...s, [key]: value }));
  }, []);

  const onFile = (f: File) => {
    setSrcName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      const img = new Image();
      img.onload = () => {
        setDims({ w: img.naturalWidth, h: img.naturalHeight });
        setSrc(url);
        setState(DEFAULTS);
      };
      img.src = url;
    };
    reader.readAsDataURL(f);
  };

  const onExport = async () => {
    if (!imgRef.current || !src) return;
    setExporting(true);
    try {
      // Decode an independent off-DOM image so we hit `naturalWidth` even if
      // the stage img is currently CSS-scaled.
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not decode source image'));
      });
      img.src = src;
      const decoded = await loaded;
      await exportPng(decoded, state, annotatedFilename(srcName));
    } catch (err) {
      console.error(err);
      alert('Export failed: ' + (err as Error).message);
    } finally {
      setExporting(false);
    }
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
              imgRef={imgRef}
            />
            <StylePanel
              s={state}
              set={set}
              onReset={() => setState(DEFAULTS)}
              onExport={onExport}
              srcName={srcName}
              exporting={exporting}
            />
          </>
        ) : (
          <UploadZone onFile={onFile} />
        )}
      </div>
    </div>
  );
}
