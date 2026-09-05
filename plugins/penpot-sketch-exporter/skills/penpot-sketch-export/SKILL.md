---
name: penpot-sketch-export
description: Build, deploy, install, and troubleshoot the Penpot-to-Sketch exporter. Use for exporting Penpot boards to editable .sketch files, not for general Penpot design work.
---

# Penpot Sketch Export

Keep the deployed artifact and the Penpot plugin registration separate: the source and `dist/` live on disk, while Penpot loads `manifest.json` through an HTTP URL.

## Local Penpot deployment

For the standard Windows Docker installation, the canonical project directory is `D:\Program Files\Penpot\server\plugins\penpot-sketch-exporter`. Its frontend mount must map:

```text
./plugins/penpot-sketch-exporter/dist
  -> /var/www/app/plugins/penpot-sketch-exporter:ro
```

The runtime manifest URL is:

```text
http://localhost:9001/plugins/penpot-sketch-exporter/manifest.json
```

Do not copy the plugin into a running container. Keep the source on the host and use the read-only Compose mount so updates survive container recreation.

## Build and verify

From the project directory, install dependencies when absent, then run `npm run check` and `npm run build`. Verify that the manifest and `plugin.js` both return HTTP 200 from the runtime URL before asking anyone to register or run the plugin.

If the `/plugins/` mount changes, recreate only `penpot-frontend` with the existing Compose file. A source-only rebuild updates the mounted `dist/` directory; do not restart the database, backend, or delete Docker volumes for an exporter update.

## Install and export

In a Penpot file, open the plugin manager and register the runtime manifest URL above. Open `Export to Figma (.sketch)` with the plugin command, select the required boards, then download one `.sketch` file. The output is intended to be dragged onto the Figma Recent or Drafts page; it does not require a Figma plugin.

Before calling an export successful, check that the browser download completed and open the resulting archive to confirm it contains `document.json`, `meta.json`, at least one `pages/*.json`, and any expected embedded images. Do not claim Figma import fidelity without opening it in Figma.

## Troubleshooting order

1. Confirm the active Penpot URL is `localhost:9001` and the manifest URL returns JSON with `code: "plugin.js"`.
2. Confirm `plugin.js` is reachable beside the manifest and that the frontend container has the `dist` bind mount.
3. Re-register the manifest in the current browser profile if Penpot reports the plugin missing; registration is profile-scoped.
4. For export errors, reproduce with one simple board first, then add text, vectors, images, and masks to isolate the failing content.
5. Preserve the source project and Docker volumes. Do not reset or rebuild the Penpot stack as a first response.

## Export-fidelity changes

Before changing the serializer, media transfer, or Sketch writer, read [the export architecture reference](references/export-architecture.md). Keep its transport and fidelity invariants unless the task specifically validates a replacement.
