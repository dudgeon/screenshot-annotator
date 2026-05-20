# Spotlight — Screenshot Annotator

A small local web app for producing **annotated screenshots** to drop inline
into GitHub READMEs and other markdown contexts.

The output is a single flattened PNG: an unaltered region of the original
screenshot (the "focus") sits crisp and slightly raised on top of a lightened,
softly-blurred copy of the same screenshot, with a short headline + body of
text floating directly on the blurred surface.

## Run it

```sh
npm install
npm run dev          # http://localhost:5173
```

Or build a static bundle:

```sh
npm run build
npm run preview
```

## Use it

1. Drop a screenshot onto the upload zone (PNG / JPEG, any size).
2. Drag the focus rect, resize it from a corner, click the headline or body
   to edit inline.
3. Tweak blur / lightness / tint / shadow / magnification from the right
   panel.
4. Hit **Export PNG**. A flattened image at the screenshot's native
   resolution downloads as `<name>.annotated.png`.

State and the loaded screenshot persist to `localStorage`, so a refresh
restores your work.

Embed the result in a README:

```markdown
![Project file tree](docs/screenshots/file-tree.annotated.png)
```
