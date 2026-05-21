# Roadmap

Open work, oldest first. Strike through (`~~…~~`) on completion.

## Now

_(empty — file issues here as they come up)_

## Backlog

- **Live preview parity for transparency.** The export now preserves source
  PNG alpha, but the editor still paints the scrim over the full stage —
  transparent regions of the source render with a white wash in the preview
  while the exported PNG is fully transparent. Mask the live scrim div with
  the source image's alpha (CSS `mask-image` + `mask-mode: alpha`, falling
  back to a checkerboard background where unsupported).

## Done

- Deployed to <https://dudgeon.org/screenshot-annotator/> via Actions.
- Export fidelity: scale blur/shadow by measured stage width.
- Multiple callouts (array model, per-callout headline color).
- Copy PNG to clipboard.
- Undo/redo + keyboard shortcuts (⌘Z, arrows, Esc, Delete).
- Self-demo screenshot in README.
- Paste from clipboard as upload step.
- Preserve source transparency in export (scrim painted via `source-atop`).
