export type Focus = { x: number; y: number; w: number; h: number };
export type Caption = { x: number; y: number; w: number };

export type SpotlightState = {
  focus: Focus;
  caption: Caption;
  title: string;
  body: string;
  blurPx: number;
  scrimAlpha: number;
  scrimColor: string;
  shadowSize: number;
  shadowDepth: number;
  lensRadius: number;
  lensZoom: number;
  headlineColor: string;
};

export const DEFAULTS: SpotlightState = {
  focus: { x: 8, y: 15, w: 22, h: 60 },
  caption: { x: 36, y: 28, w: 50 },
  title: 'Your headline',
  body: 'Add a one-line description of what this part of the screenshot does.',
  blurPx: 2,
  scrimAlpha: 0.83,
  scrimColor: '#ffffff',
  shadowSize: 9,
  shadowDepth: 3,
  lensRadius: 7,
  lensZoom: 0,
  headlineColor: '#c04a2b',
};
