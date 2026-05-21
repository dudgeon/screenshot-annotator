export type Focus = { x: number; y: number; w: number; h: number };
export type Caption = { x: number; y: number; w: number };

export type Callout = {
  id: string;
  focus: Focus;
  caption: Caption;
  title: string;
  body: string;
  headlineColor: string;
};

export type SpotlightState = {
  callouts: Callout[];
  selectedId: string | null;
  blurPx: number;
  scrimAlpha: number;
  scrimColor: string;
  shadowSize: number;
  shadowDepth: number;
  lensRadius: number;
  lensZoom: number;
};

const CALLOUT_DEFAULTS: Omit<Callout, 'id'> = {
  focus: { x: 8, y: 15, w: 22, h: 60 },
  caption: { x: 36, y: 28, w: 50 },
  title: 'Your headline',
  body: 'Add a one-line description of what this part of the screenshot does.',
  headlineColor: '#c04a2b',
};

export function newCallout(overrides: Partial<Omit<Callout, 'id'>> = {}): Callout {
  return { id: crypto.randomUUID(), ...CALLOUT_DEFAULTS, ...overrides };
}

const STYLE_DEFAULTS = {
  blurPx: 2,
  scrimAlpha: 0.83,
  scrimColor: '#ffffff',
  shadowSize: 9,
  shadowDepth: 3,
  lensRadius: 7,
  lensZoom: 0,
} as const;

export function defaultState(): SpotlightState {
  const c = newCallout();
  return { callouts: [c], selectedId: c.id, ...STYLE_DEFAULTS };
}

// Stagger a new callout so it's visible alongside existing ones rather than
// landing exactly on top.
export function addCallout(state: SpotlightState): SpotlightState {
  const last = state.callouts[state.callouts.length - 1];
  const offset = state.callouts.length * 4;
  const c = newCallout(
    last
      ? {
          focus: {
            x: Math.min(70, last.focus.x + offset),
            y: last.focus.y,
            w: last.focus.w,
            h: last.focus.h,
          },
          caption: {
            x: Math.min(60, last.caption.x + offset),
            y: Math.min(80, last.caption.y + 8),
            w: last.caption.w,
          },
        }
      : {},
  );
  return { ...state, callouts: [...state.callouts, c], selectedId: c.id };
}
