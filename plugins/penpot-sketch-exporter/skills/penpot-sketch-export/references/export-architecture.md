# Export architecture and regression baseline

Read this when changing `src/plugin.ts`, `src/main.ts`, or `src/sketch-converter.ts`, or when investigating a fidelity regression.

## Architecture decisions

- Read the selected boards through the Penpot Plugin API. Do not export and re-import a complete `.penpot` archive merely to produce Sketch output; large source archives have made this path impractical.
- Keep ordinary text and vectors as native Sketch layers. Rasterize only a shape with an image fill, raw SVG, or a masked group that cannot retain its appearance reliably as editable layers.
- Send serialized shapes in batches of 100. Render at most 6 media objects in parallel. Transfer each image to the UI in 512 KiB chunks with short cooperative yields, then assemble the `.sketch` archive in the UI.
- Render masked logo groups at 2× and preserve their clipping-mask relationship in Sketch. This avoids lost masks and visibly soft branding marks after Figma imports the file.

## Verification

Test a simple board first when isolating failures, then add text, paths, image fills, and masks one category at a time. Inspect the downloaded archive before an import test.

The known regression sample, **Concept 1 V3**, produced 3 artboards, 2,701 layers, and 49 embedded images. Use those counts only as a baseline for that exact source document, not as a general output guarantee. Confirm final visual fidelity by opening the result in Figma.
