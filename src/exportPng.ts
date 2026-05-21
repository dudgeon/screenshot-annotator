import { hexToRgb } from './utils';
import type { Callout, SpotlightState } from './types';

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? line + ' ' + w : w;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawCallout(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  callout: Callout,
  state: SpotlightState,
  cv: HTMLCanvasElement,
  scale: number,
) {
  const focusPx = {
    x: (callout.focus.x / 100) * cv.width,
    y: (callout.focus.y / 100) * cv.height,
    w: (callout.focus.w / 100) * cv.width,
    h: (callout.focus.h / 100) * cv.height,
  };
  const lensRadius = state.lensRadius * scale;

  // Shadow under the lens. Math mirrors EditorStage's box-shadow.
  const sBlur = state.shadowSize * 0.9 * scale;
  const sY = state.shadowDepth * 0.45 * scale;
  const sAlpha = Math.min(0.75, 0.18 + state.shadowDepth / 180);

  ctx.save();
  ctx.shadowColor = `rgba(20,14,8,${sAlpha})`;
  ctx.shadowBlur = sBlur;
  ctx.shadowOffsetY = sY;
  roundedRect(ctx, focusPx.x, focusPx.y, focusPx.w, focusPx.h, lensRadius);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  // Clip to the rounded rect and draw the (optionally magnified) crop.
  ctx.save();
  roundedRect(ctx, focusPx.x, focusPx.y, focusPx.w, focusPx.h, lensRadius);
  ctx.clip();
  const M = 1 + state.lensZoom / 100;
  const cx = focusPx.x + focusPx.w / 2;
  const cy = focusPx.y + focusPx.h / 2;
  const srcW = focusPx.w / M;
  const srcH = focusPx.h / M;
  ctx.drawImage(
    img,
    cx - srcW / 2,
    cy - srcH / 2,
    srcW,
    srcH,
    focusPx.x,
    focusPx.y,
    focusPx.w,
    focusPx.h,
  );

  // Inner 1px highlight to match `box-shadow: inset 0 0 0 1px rgba(255,255,255,.5)`.
  ctx.lineWidth = Math.max(1, scale);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  roundedRect(
    ctx,
    focusPx.x + ctx.lineWidth / 2,
    focusPx.y + ctx.lineWidth / 2,
    focusPx.w - ctx.lineWidth,
    focusPx.h - ctx.lineWidth,
    Math.max(0, lensRadius - ctx.lineWidth / 2),
  );
  ctx.stroke();
  ctx.restore();

  // Caption text. Sizes are a proportion of image width — matches HANDOFF.
  const headlinePx = Math.round(cv.width * 0.013);
  const bodyPx = Math.round(cv.width * 0.020);
  const capX = (callout.caption.x / 100) * cv.width;
  const capY = (callout.caption.y / 100) * cv.height;
  const capW = (callout.caption.w / 100) * cv.width;

  ctx.fillStyle = callout.headlineColor;
  ctx.textBaseline = 'top';
  ctx.font = `600 ${headlinePx}px Inter, system-ui, sans-serif`;
  type CtxWithLetterSpacing = CanvasRenderingContext2D & { letterSpacing?: string };
  try {
    (ctx as CtxWithLetterSpacing).letterSpacing = `${headlinePx * 0.22}px`;
  } catch {
    /* unsupported */
  }
  ctx.fillText(callout.title.toUpperCase(), capX, capY);
  try {
    (ctx as CtxWithLetterSpacing).letterSpacing = '0px';
  } catch {
    /* unsupported */
  }

  // 1em of headline below = headlinePx of margin.
  const bodyTop = capY + headlinePx + headlinePx;
  ctx.fillStyle = '#1f1a14';
  ctx.font = `400 ${bodyPx}px Inter, system-ui, sans-serif`;
  const bodyLines = wrapText(ctx, callout.body, capW);
  const bodyLineHeight = bodyPx * 1.35;
  bodyLines.forEach((line, i) => {
    ctx.fillText(line, capX, bodyTop + i * bodyLineHeight);
  });
}

export async function renderPng(
  img: HTMLImageElement,
  state: SpotlightState,
  renderedStageWidth: number,
): Promise<Blob> {
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('No 2D context');

  // `blurPx` and shadow values in state are CSS px against the rendered
  // stage. Scale by canvas-px / stage-css-px to match the live preview.
  const scale = cv.width / renderedStageWidth;

  ctx.filter = `blur(${state.blurPx * scale}px) saturate(0.9)`;
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  ctx.filter = 'none';

  const { r, g, b } = hexToRgb(state.scrimColor);
  ctx.fillStyle = `rgba(${r},${g},${b},${state.scrimAlpha})`;
  ctx.fillRect(0, 0, cv.width, cv.height);

  for (const c of state.callouts) {
    drawCallout(ctx, img, c, state, cv, scale);
  }

  return new Promise<Blob>((resolve, reject) => {
    cv.toBlob((blob) => {
      if (!blob) reject(new Error('Failed to encode PNG'));
      else resolve(blob);
    }, 'image/png');
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportPng(
  img: HTMLImageElement,
  state: SpotlightState,
  filename: string,
  renderedStageWidth: number,
): Promise<void> {
  const blob = await renderPng(img, state, renderedStageWidth);
  downloadBlob(blob, filename);
}
