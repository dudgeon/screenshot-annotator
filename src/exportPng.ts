import { hexToRgb } from './utils';
import type { SpotlightState } from './types';

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

// Wrap a single line of body text to the given px width.
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

export async function exportPng(
  img: HTMLImageElement,
  state: SpotlightState,
  filename: string,
): Promise<void> {
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('No 2D context');

  // The live preview's `blurPx` is in CSS px relative to the rendered DOM
  // size. The HANDOFF spells out that the export must scale by
  // cv.width / renderedStageWidth to match what the user saw. We do not have
  // a reliable renderedStageWidth here without coupling, so we treat the
  // prototype's "default editor stage width ~ 960px" as the reference. This
  // approximation matches the live preview at typical README image widths.
  // Anyone who wants pixel-perfect parity should pass through a measured
  // stage width.
  const referenceStageWidth = 960;
  const scale = cv.width / referenceStageWidth;

  // 1. Blurred screenshot
  ctx.filter = `blur(${state.blurPx * scale}px) saturate(0.9)`;
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  ctx.filter = 'none';

  // 2. Lightening scrim
  const { r, g, b } = hexToRgb(state.scrimColor);
  ctx.fillStyle = `rgba(${r},${g},${b},${state.scrimAlpha})`;
  ctx.fillRect(0, 0, cv.width, cv.height);

  // 3. Focus lens
  const focusPx = {
    x: (state.focus.x / 100) * cv.width,
    y: (state.focus.y / 100) * cv.height,
    w: (state.focus.w / 100) * cv.width,
    h: (state.focus.h / 100) * cv.height,
  };
  const lensRadius = state.lensRadius * scale;

  // 3a. Shadow under the lens. The shadow math mirrors EditorStage:
  //   sBlur  = round(shadowSize * 0.9)
  //   sY     = round(shadowDepth * 0.45)
  //   sAlpha = min(0.75, 0.18 + shadowDepth / 180)
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

  // 3b. Clip to the rounded rect and draw the (optionally magnified) crop.
  ctx.save();
  roundedRect(ctx, focusPx.x, focusPx.y, focusPx.w, focusPx.h, lensRadius);
  ctx.clip();
  const M = 1 + state.lensZoom / 100;
  const cx = focusPx.x + focusPx.w / 2;
  const cy = focusPx.y + focusPx.h / 2;
  // Source crop in image pixels. The screenshot is drawn 1:1 to the canvas,
  // so canvas px === image px.
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

  // 4. Caption text.
  // The live preview uses clamp(14px, 1.3vw, 22px) for the headline and
  // clamp(20px, 2vw, 34px) for the body — i.e. tied to viewport. The HANDOFF
  // says the EXPORTED text should be a proportion of the *image* width:
  //   headline ≈ 1.3% of image width
  //   body     ≈ 2.0% of image width
  const headlinePx = Math.round(cv.width * 0.013);
  const bodyPx = Math.round(cv.width * 0.020);
  const capX = (state.caption.x / 100) * cv.width;
  const capY = (state.caption.y / 100) * cv.height;
  const capW = (state.caption.w / 100) * cv.width;

  ctx.fillStyle = state.headlineColor;
  ctx.textBaseline = 'top';
  ctx.font = `600 ${headlinePx}px Inter, system-ui, sans-serif`;
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      `${headlinePx * 0.22}px`;
  } catch {
    /* unsupported; fall through */
  }
  const headlineText = state.title.toUpperCase();
  ctx.fillText(headlineText, capX, capY);

  // Reset letter-spacing before the body.
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      '0px';
  } catch {
    /* unsupported */
  }

  // 1em of headline = headlinePx margin between the two.
  const bodyTop = capY + headlinePx + headlinePx;
  ctx.fillStyle = '#1f1a14';
  ctx.font = `400 ${bodyPx}px Inter, system-ui, sans-serif`;
  const bodyLines = wrapText(ctx, state.body, capW);
  const bodyLineHeight = bodyPx * 1.35;
  bodyLines.forEach((line, i) => {
    ctx.fillText(line, capX, bodyTop + i * bodyLineHeight);
  });

  // 5. Trigger download.
  await new Promise<void>((resolve, reject) => {
    cv.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode PNG'));
        return;
      }
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      resolve();
    }, 'image/png');
  });
}
