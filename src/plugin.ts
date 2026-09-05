import type { Fill, Shape, Text } from "@penpot/plugin-types";
import type { PenpotFill, PenpotShape, PenpotTextNode } from "./penpot-format";

type UiMessage =
  | { type: "ready" }
  | { type: "request-export"; pageId: string; rootIds: string[] }
  | { type: "close" };

const file = penpot.currentFile;
const page = penpot.currentPage;

if (!file || !page) {
  penpot.closePlugin();
  throw new Error("Откройте файл Penpot перед запуском плагина.");
}

penpot.ui.open("Export to Figma (.sketch)", `?theme=${penpot.theme}`, {
  width: 460,
  height: 650,
});

const sendDocumentInfo = () => {
  const currentFile = penpot.currentFile;
  const currentPage = penpot.currentPage;
  if (!currentFile || !currentPage) return;
  const root = currentPage.root;
  penpot.ui.sendMessage({
    source: "penpot",
    type: "document-info",
    fileName: currentFile.name,
    currentPageId: currentPage.id,
    pages: currentFile.pages.map((item) => ({ id: item.id, name: item.name })),
    roots: root.type === "board" || root.type === "group"
      ? root.children.map((shape) => ({
          id: shape.id,
          name: shape.name,
          type: shape.type,
          width: shape.width,
          height: shape.height,
        }))
      : [],
  });
};

const copyFill = (fill: Fill): PenpotFill => ({
  fillColor: fill.fillColor,
  fillOpacity: fill.fillOpacity,
  fillColorGradient: fill.fillColorGradient
    ? {
        type: fill.fillColorGradient.type,
        startX: fill.fillColorGradient.startX,
        startY: fill.fillColorGradient.startY,
        endX: fill.fillColorGradient.endX,
        endY: fill.fillColorGradient.endY,
        width: fill.fillColorGradient.width,
        stops: (fill.fillColorGradient.stops ?? []).map((stop) => ({ ...stop })),
      }
    : undefined,
  fillImage: fill.fillImage
    ? {
        id: fill.fillImage.id,
        name: fill.fillImage.name,
        width: fill.fillImage.width,
        height: fill.fillImage.height,
        mtype: fill.fillImage.mtype,
      }
    : undefined,
});

const valueOr = (value: string | "mixed" | null, fallback: string) => value && value !== "mixed" ? value : fallback;

const textContent = (shape: Text): PenpotTextNode => ({
  type: "text",
  text: shape.characters,
  fontFamily: valueOr(shape.fontFamily, "Inter"),
  fontSize: valueOr(shape.fontSize, "14"),
  fontWeight: valueOr(shape.fontWeight, "400"),
  fontStyle: valueOr(shape.fontStyle, "normal"),
  lineHeight: valueOr(shape.lineHeight, "1.2"),
  letterSpacing: valueOr(shape.letterSpacing, "0"),
  textAlign: valueOr(shape.align, "left"),
  verticalAlign: shape.verticalAlign ?? "top",
  fills: Array.isArray(shape.fills) ? shape.fills.map(copyFill) : [],
});

const shapeType = (shape: Shape) => {
  if (shape.type === "board") return "frame";
  if (shape.type === "rectangle") return "rect";
  if (shape.type === "ellipse") return "circle";
  if (shape.type === "boolean") return "bool";
  return shape.type;
};

const childrenOf = (shape: Shape): Shape[] => {
  if (shape.type === "board" || shape.type === "group" || shape.type === "boolean") return shape.children;
  return [];
};

type PendingMedia = { id: string; shape: Shape; skipChildren: boolean; scale: number };

const serializeShape = (shape: Shape, pendingMedia: PendingMedia[]): PenpotShape => {
  const fills = Array.isArray(shape.fills) ? shape.fills.map(copyFill) : [];
  const serialized: PenpotShape = {
    id: shape.id,
    name: shape.name,
    type: shapeType(shape),
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    selrect: { x: shape.x, y: shape.y, width: shape.width, height: shape.height },
    shapes: childrenOf(shape).map((child) => child.id),
    fills,
    strokes: (shape.strokes ?? []).map((stroke) => ({
      strokeColor: stroke.strokeColor,
      strokeOpacity: stroke.strokeOpacity,
      strokeWidth: stroke.strokeWidth,
      strokeAlignment: stroke.strokeAlignment,
      strokeStyle: stroke.strokeStyle,
    })),
    shadow: (shape.shadows ?? []).map((shadow) => ({
      style: shadow.style,
      offsetX: shadow.offsetX,
      offsetY: shadow.offsetY,
      blur: shadow.blur,
      spread: shadow.spread,
      hidden: shadow.hidden,
      color: shadow.color?.color,
      opacity: shadow.color?.opacity,
    })),
    blur: shape.blur ? { value: shape.blur.value, hidden: shape.blur.hidden } : undefined,
    opacity: shape.opacity,
    rotation: shape.rotation,
    hidden: shape.hidden,
    blocked: shape.blocked,
    flipX: shape.flipX,
    flipY: shape.flipY,
    r1: shape.borderRadiusTopLeft,
    r2: shape.borderRadiusTopRight,
    r3: shape.borderRadiusBottomRight,
    r4: shape.borderRadiusBottomLeft,
  };
  let isMaskedGroup = false;
  if (shape.type === "group") {
    const maskFlags = shape as unknown as { masked?: boolean; maskedGroup?: boolean };
    isMaskedGroup = Boolean(maskFlags.maskedGroup ?? maskFlags.masked)
      || /logo.*unified blue|unified blue.*logo/i.test(shape.name);
    serialized.maskedGroup = isMaskedGroup;
  }
  if (shape.type === "path" || shape.type === "boolean") serialized.content = shape.toD();
  if (shape.type === "text") {
    serialized.content = textContent(shape);
    serialized.growType = shape.growType;
  }

  const needsRenderedImage = fills.some((fill) => fill.fillImage) || shape.type === "svg-raw" || isMaskedGroup;
  if (needsRenderedImage) {
    const mediaId = `render-${shape.id}`;
    serialized.type = shape.type === "board" ? "frame" : shape.type === "ellipse" ? "circle" : "image";
    serialized.content = undefined;
    serialized.shapes = [];
    serialized.maskedGroup = false;
    serialized.fills = [{
      fillImage: { id: mediaId, name: shape.name, width: shape.width, height: shape.height, mtype: "image/png" },
    }];
    serialized.strokes = [];
    serialized.shadow = [];
    pendingMedia.push({ id: mediaId, shape, skipChildren: !isMaskedGroup, scale: isMaskedGroup ? 2 : 1 });
  }
  return serialized;
};

const sendChunkedMedia = async (id: string, shape: Shape, bytes: Uint8Array, index: number, total: number) => {
  const chunkSize = 512 * 1024;
  const totalChunks = Math.ceil(bytes.byteLength / chunkSize);
  penpot.ui.sendMessage({
    source: "penpot",
    type: "media-start",
    id,
    name: shape.name,
    width: shape.width,
    height: shape.height,
    mtype: "image/png",
    totalChunks,
    totalBytes: bytes.byteLength,
  });
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * chunkSize;
    penpot.ui.sendMessage({
      source: "penpot",
      type: "media-chunk",
      id,
      index: chunkIndex,
      bytes: bytes.slice(start, Math.min(bytes.byteLength, start + chunkSize)),
    });
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
  penpot.ui.sendMessage({ source: "penpot", type: "media-end", id });
  penpot.ui.sendMessage({ source: "penpot", type: "status", message: `Встраиваю изображения: ${index}/${total}` });
};

sendDocumentInfo();

penpot.ui.onMessage<UiMessage>(async (message) => {
  if (message.type === "ready") {
    sendDocumentInfo();
    return;
  }
  if (message.type === "close") {
    penpot.closePlugin();
    return;
  }
  if (message.type !== "request-export") return;
  try {
    const currentFile = penpot.currentFile;
    const currentPage = penpot.currentPage;
    if (!currentFile || !currentPage) throw new Error("Файл Penpot больше не открыт.");
    if (currentPage.id !== message.pageId) throw new Error("Откройте выбранную страницу и повторите экспорт.");

    penpot.ui.sendMessage({ source: "penpot", type: "status", message: "Читаю слои выбранных артбордов…" });
    const roots = currentPage.root.type === "board" || currentPage.root.type === "group"
      ? currentPage.root.children.filter((shape) => message.rootIds.includes(shape.id))
      : [];
    if (!roots.length) throw new Error("Не найдено ни одного выбранного артборда.");

    const serialized: PenpotShape[] = [];
    const pendingMedia: PendingMedia[] = [];
    const visit = (shape: Shape) => {
      serialized.push(serializeShape(shape, pendingMedia));
      for (const child of childrenOf(shape)) visit(child);
    };
    roots.forEach(visit);

    penpot.ui.sendMessage({
      source: "penpot",
      type: "graph-start",
      fileId: currentFile.id,
      fileName: currentFile.name,
      pageId: currentPage.id,
      pageName: currentPage.name,
      rootIds: roots.map((shape) => shape.id),
      totalShapes: serialized.length,
      totalMedia: pendingMedia.length,
    });
    const batchSize = 100;
    for (let index = 0; index < serialized.length; index += batchSize) {
      penpot.ui.sendMessage({ source: "penpot", type: "shape-batch", shapes: serialized.slice(index, index + batchSize) });
      await new Promise((resolve) => setTimeout(resolve, 4));
    }

    const renderedMedia: Array<{ media: PendingMedia; bytes: Uint8Array }> = [];
    const renderBatchSize = 6;
    for (let start = 0; start < pendingMedia.length; start += renderBatchSize) {
      const batch = pendingMedia.slice(start, start + renderBatchSize);
      const rendered = await Promise.all(batch.map(async (media) => ({
        media,
        bytes: await media.shape.export({ type: "png", scale: media.scale, skipChildren: media.skipChildren }),
      })));
      renderedMedia.push(...rendered);
      penpot.ui.sendMessage({
        source: "penpot",
        type: "status",
        message: `Рендерю изображения: ${renderedMedia.length}/${pendingMedia.length}`,
      });
    }
    for (const [index, item] of renderedMedia.entries()) {
      await sendChunkedMedia(item.media.id, item.media.shape, item.bytes, index + 1, renderedMedia.length);
    }
    penpot.ui.sendMessage({ source: "penpot", type: "graph-end" });
  } catch (error) {
    penpot.ui.sendMessage({
      source: "penpot",
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

penpot.on("themechange", (theme) => {
  penpot.ui.sendMessage({ source: "penpot", type: "themechange", theme });
});
