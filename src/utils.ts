export const clamp = (v: number, a: number, b: number) =>
  Math.max(a, Math.min(b, v));

export const hexToRgb = (hex: string) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
    : { r: 255, g: 255, b: 255 };
};

export const rgba = (hex: string, a: number) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

export const annotatedFilename = (src: string | null) => {
  if (!src) return 'annotated.png';
  const dot = src.lastIndexOf('.');
  if (dot < 0) return `${src}.annotated.png`;
  return `${src.slice(0, dot)}.annotated.png`;
};
