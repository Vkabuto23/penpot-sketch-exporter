import JSZip from "jszip";
import svgpath from "svgpath";
import svgPathParser from "svg-path-parser";
import type { PenpotFill, PenpotManifest, PenpotMedia, PenpotPage, PenpotShape, PenpotTextNode } from "./penpot-format";

type Json = Record<string, any>;
type Bounds = { x: number; y: number; width: number; height: number };
type ConvertOptions = { pageId?: string; rootIds?: string[]; onProgress?: (value: number, label: string) => void };

export type PenpotGraphMedia = {
  id: string;
  bytes: Uint8Array;
  name?: string;
  width?: number;
  height?: number;
  mtype?: string;
};

export type PenpotGraph = {
  fileId: string;
  fileName: string;
  pageId: string;
  pageName: string;
  rootIds: string[];
  shapes: PenpotShape[];
  media: PenpotGraphMedia[];
};

const uuid = () => crypto.randomUUID().toUpperCase();
const num = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bounds = (shape: PenpotShape): Bounds => ({
  x: num(shape.x ?? shape.selrect?.x),
  y: num(shape.y ?? shape.selrect?.y),
  width: Math.max(0.01, num(shape.width ?? shape.selrect?.width, 0.01)),
  height: Math.max(0.01, num(shape.height ?? shape.selrect?.height, 0.01)),
});
const point = (x: number, y: number) => `{${Number(x.toFixed(6))}, ${Number(y.toFixed(6))}}`;

const color = (hex = "#000000", opacity = 1) => {
  let value = hex.replace("#", "").trim();
  if (value.length === 3 || value.length === 4) value = value.split("").map((item) => item + item).join("");
  const alpha = value.length >= 8 ? Number.parseInt(value.slice(6, 8), 16) / 255 : 1;
  const rgb = value.slice(0, 6).padEnd(6, "0");
  return {
    _class: "color",
    alpha: Math.max(0, Math.min(1, opacity * alpha)),
    red: Number.parseInt(rgb.slice(0, 2), 16) / 255,
    green: Number.parseInt(rgb.slice(2, 4), 16) / 255,
    blue: Number.parseInt(rgb.slice(4, 6), 16) / 255,
  };
};

const graphicsContext = (opacity = 1) => ({ _class: "graphicsContextSettings", blendMode: 0, opacity });
const gradient = (fill?: PenpotFill) => {
  const source = fill?.fillColorGradient;
  const stops = source?.stops?.length ? source.stops : [
    { color: "#ffffff", opacity: 1, offset: 0 },
    { color: "#000000", opacity: 1, offset: 1 },
  ];
  return {
    _class: "gradient",
    gradientType: source?.type === "radial" ? 1 : source?.type === "angular" ? 2 : 0,
    elipseLength: num(source?.width),
    from: point(num(source?.startX, 0.5), num(source?.startY, 0)),
    to: point(num(source?.endX, 0.5), num(source?.endY, 1)),
    stops: stops.map((stop) => ({
      _class: "gradientStop",
      position: num(stop.offset),
      color: color(stop.color, stop.opacity ?? 1),
    })),
  };
};

const exportOptions = () => ({ _class: "exportOptions", includedLayerIds: [], layerOptions: 0, shouldTrim: false, exportFormats: [] });
const rect = (box: Bounds, parentBox?: Bounds) => ({
  _class: "rect",
  constrainProportions: false,
  x: box.x - (parentBox?.x ?? 0),
  y: box.y - (parentBox?.y ?? 0),
  width: box.width,
  height: box.height,
});
const baseLayer = (shape: PenpotShape, parentBox?: Bounds) => ({
  do_objectID: shape.id.toUpperCase(),
  booleanOperation: -1,
  exportOptions: exportOptions(),
  frame: rect(bounds(shape), parentBox),
  isFixedToViewport: false,
  isFlippedHorizontal: Boolean(shape.flipX),
  isFlippedVertical: Boolean(shape.flipY),
  isLocked: Boolean(shape.blocked),
  isTemplate: false,
  isVisible: !shape.hidden,
  layerListExpandedType: 0,
  maintainScrollPosition: false,
  name: shape.name || shape.type,
  nameIsFixed: false,
  resizingConstraint: 63,
  resizingType: 0,
  rotation: num(shape.rotation),
  shouldBreakMaskChain: false,
  clippingMaskMode: 0,
  hasClippingMask: false,
});
const imageRef = (path: string) => ({ _class: "MSJSONFileReference", _ref_class: "MSImageData", _ref: path });

const makeStyle = (shape: PenpotShape, images: Map<string, string>, textStyle?: Json) => {
  const fills = (shape.fills ?? []).map((fill) => {
    const imagePath = fill.fillImage?.id ? images.get(fill.fillImage.id) : undefined;
    return {
      _class: "fill",
      isEnabled: true,
      fillType: imagePath ? 2 : fill.fillColorGradient ? 1 : 0,
      color: color(fill.fillColor ?? "#ffffff", fill.fillOpacity ?? 1),
      contextSettings: graphicsContext(1),
      gradient: gradient(fill),
      noiseIndex: 0,
      noiseIntensity: 0,
      patternFillType: 1,
      patternTileScale: 1,
      ...(imagePath ? { image: imageRef(imagePath) } : {}),
    };
  });
  const borders = (shape.strokes ?? []).filter((item) => item.strokeColor).map((stroke) => ({
    _class: "border",
    isEnabled: true,
    fillType: 0,
    color: color(stroke.strokeColor, stroke.strokeOpacity ?? 1),
    contextSettings: graphicsContext(1),
    gradient: gradient(),
    position: stroke.strokeAlignment === "inner" ? 1 : stroke.strokeAlignment === "outer" ? 2 : 0,
    thickness: Math.max(0, num(stroke.strokeWidth, 1)),
  }));
  const shadow = (item: NonNullable<PenpotShape["shadow"]>[number], inner: boolean) => ({
    _class: inner ? "innerShadow" : "shadow",
    isEnabled: true,
    blurRadius: Math.max(0, num(item.blur)),
    color: color(item.color, item.opacity ?? 1),
    contextSettings: graphicsContext(1),
    offsetX: num(item.offsetX),
    offsetY: num(item.offsetY),
    spread: num(item.spread),
  });
  return {
    _class: "style",
    do_objectID: uuid(),
    endMarkerType: 0,
    miterLimit: 10,
    startMarkerType: 0,
    windingRule: 1,
    blur: {
      _class: "blur",
      isEnabled: Boolean(shape.blur && !shape.blur.hidden && num(shape.blur.value) > 0),
      center: "{0.5, 0.5}",
      motionAngle: 0,
      radius: Math.max(0, num(shape.blur?.value, 10)),
      saturation: 1,
      type: 0,
    },
    borderOptions: { _class: "borderOptions", isEnabled: true, dashPattern: [], lineCapStyle: 0, lineJoinStyle: 0 },
    borders,
    colorControls: { _class: "colorControls", isEnabled: false, brightness: 0, contrast: 1, hue: 0, saturation: 1 },
    contextSettings: graphicsContext(shape.opacity ?? 1),
    fills,
    innerShadows: (shape.shadow ?? []).filter((item) => !item.hidden && item.style === "inner-shadow").map((item) => shadow(item, true)),
    shadows: (shape.shadow ?? []).filter((item) => !item.hidden && item.style !== "inner-shadow").map((item) => shadow(item, false)),
    ...(textStyle ? { textStyle } : {}),
  };
};

const curvePoint = (x: number, y: number, box: Bounds, cornerRadius = 0) => {
  const value = point((x - box.x) / box.width, (y - box.y) / box.height);
  return {
    _class: "curvePoint",
    cornerRadius,
    cornerStyle: 0,
    curveFrom: value,
    curveTo: value,
    hasCurveFrom: false,
    hasCurveTo: false,
    curveMode: 1,
    point: value,
  };
};
const rectangularPoints = (shape: PenpotShape) => {
  const box = bounds(shape);
  return [
    curvePoint(box.x, box.y, box, num(shape.r1)),
    curvePoint(box.x + box.width, box.y, box, num(shape.r2)),
    curvePoint(box.x + box.width, box.y + box.height, box, num(shape.r3)),
    curvePoint(box.x, box.y + box.height, box, num(shape.r4)),
  ];
};
const ellipsePoints = (shape: PenpotShape) => {
  const box = bounds(shape);
  const handle = 0.276142374916;
  const raw = [
    { x: .5, y: 0, fx: .5 - handle, fy: 0, tx: .5 + handle, ty: 0 },
    { x: 1, y: .5, fx: 1, fy: .5 - handle, tx: 1, ty: .5 + handle },
    { x: .5, y: 1, fx: .5 + handle, fy: 1, tx: .5 - handle, ty: 1 },
    { x: 0, y: .5, fx: 0, fy: .5 + handle, tx: 0, ty: .5 - handle },
  ];
  return raw.map((item) => ({
    ...curvePoint(box.x + item.x * box.width, box.y + item.y * box.height, box),
    curveFrom: point(item.tx, item.ty),
    curveTo: point(item.fx, item.fy),
    hasCurveFrom: true,
    hasCurveTo: true,
    curveMode: 2,
  }));
};

const pathLayers = (shape: PenpotShape, parentBox: Bounds | undefined, images: Map<string, string>): Json[] => {
  if (typeof shape.content !== "string" || !shape.content.trim()) return [];
  const box = bounds(shape);
  const commands = svgPathParser.parseSVG(svgpath(shape.content).abs().unshort().unarc().toString());
  const subpaths: Array<{ points: Json[]; closed: boolean }> = [];
  let current: { points: Json[]; closed: boolean } | undefined;
  let previous = { x: box.x, y: box.y };
  for (const command of commands as Array<Record<string, any>>) {
    if (command.code === "M") {
      current = { points: [curvePoint(command.x, command.y, box)], closed: false };
      subpaths.push(current);
      previous = { x: command.x, y: command.y };
      continue;
    }
    if (!current) continue;
    if (command.code === "Z") {
      current.closed = true;
      continue;
    }
    const endX = command.x ?? previous.x;
    const endY = command.y ?? previous.y;
    const next = curvePoint(endX, endY, box);
    const prior = current.points[current.points.length - 1];
    // In the Sketch file format, curveFrom leaves the current anchor and
    // curveTo enters the next one. Reversing these creates loops/gaps in
    // outlined strokes. See sketch-hq/sketch-reference-files/shape-paths.
    if (command.code === "C") {
      prior.curveFrom = point((command.x1 - box.x) / box.width, (command.y1 - box.y) / box.height);
      prior.hasCurveFrom = true;
      prior.curveMode = 4;
      next.curveTo = point((command.x2 - box.x) / box.width, (command.y2 - box.y) / box.height);
      next.hasCurveTo = true;
      next.curveMode = 4;
    } else if (command.code === "Q") {
      const c1x = previous.x + (2 / 3) * (command.x1 - previous.x);
      const c1y = previous.y + (2 / 3) * (command.y1 - previous.y);
      const c2x = endX + (2 / 3) * (command.x1 - endX);
      const c2y = endY + (2 / 3) * (command.y1 - endY);
      prior.curveFrom = point((c1x - box.x) / box.width, (c1y - box.y) / box.height);
      prior.hasCurveFrom = true;
      prior.curveMode = 4;
      next.curveTo = point((c2x - box.x) / box.width, (c2y - box.y) / box.height);
      next.hasCurveTo = true;
      next.curveMode = 4;
    }
    current.points.push(next);
    previous = { x: endX, y: endY };
  }
  const paths = subpaths.filter((item) => item.points.length > 1).map((item, index) => ({
    ...baseLayer({ ...shape, id: index === 0 ? shape.id : uuid(), name: index === 0 ? shape.name : `${shape.name} ${index + 1}` }, parentBox),
    _class: "shapePath",
    style: makeStyle(shape, images),
    edited: true,
    isClosed: item.closed,
    pointRadiusBehaviour: 1,
    points: item.points,
  }));
  if (paths.length <= 1) return paths;
  // One SVG path can contain outer contours and holes. Independent filled
  // layers would paint the holes solid (e.g. clocks/rings in pictograms).
  // This is an actual compound vector, unlike an ordinary Penpot group.
  return [{
    ...baseLayer(shape, parentBox),
    _class: "shapeGroup",
    style: makeStyle(shape, images),
    windingRule: 1,
    hasClickThrough: false,
    groupLayout: { _class: "MSImmutableFreeformGroupLayout" },
    layers: paths.map((path, index) => ({
      ...path,
      do_objectID: uuid(),
      name: `${shape.name} — Contour ${index + 1}`,
      frame: { ...path.frame, x: 0, y: 0 },
      rotation: 0,
      isFlippedHorizontal: false,
      isFlippedVertical: false,
      isVisible: true,
      style: makeStyle({ ...shape, opacity: 1, fills: [], strokes: [], shadow: [], blur: undefined }, images),
    })),
  }];
};

type TextRun = { text: string; style: PenpotTextNode };
const flattenText = (node: PenpotTextNode | string | undefined, inherited: PenpotTextNode = {}): TextRun[] => {
  if (typeof node === "string") return [{ text: node, style: inherited }];
  if (!node) return [];
  const merged = { ...inherited, ...node, children: undefined };
  if (node.text !== undefined) return [{ text: node.text, style: merged }];
  const groups = (node.children ?? []).map((child) => flattenText(child, merged));
  if (node.type === "paragraph-set") {
    const result: TextRun[] = [];
    groups.forEach((group, index) => {
      if (index > 0 && result.length) result.push({ text: "\n", style: result[result.length - 1].style });
      result.push(...group);
    });
    return result;
  }
  return groups.flat();
};
const fontName = (run: PenpotTextNode) => {
  const sourceFamily = String(run.fontFamily || "Inter").replace(/\s+/g, "");
  const family = sourceFamily.toLowerCase() === "manropelocal" ? "Manrope" : sourceFamily;
  const weight = num(run.fontWeight, 400);
  const italic = String(run.fontStyle).toLowerCase().includes("italic");
  const suffix = weight >= 800 ? "ExtraBold" : weight >= 700 ? "Bold" : weight >= 600 ? "SemiBold" : weight >= 500 ? "Medium" : weight <= 300 ? "Light" : "Regular";
  return `${family}-${suffix}${italic ? "Italic" : ""}`;
};
const textColor = (run: PenpotTextNode) => color(run.fills?.[0]?.fillColor ?? "#000000", run.fills?.[0]?.fillOpacity ?? 1);
const textAlign = (value: unknown) => value === "right" ? 1 : value === "center" ? 2 : value === "justify" ? 3 : 0;
const verticalAlign = (value: unknown) => value === "center" ? 1 : value === "bottom" ? 2 : 0;

const textLayer = (shape: PenpotShape, parentBox: Bounds | undefined, images: Map<string, string>, fonts: Set<string>) => {
  const runs = flattenText(shape.content as PenpotTextNode | string | undefined);
  if (!runs.length && shape.positionData?.length) runs.push(...shape.positionData.map((item) => ({ text: item.text ?? "", style: item })));
  const fullText = runs.map((item) => item.text).join("");
  const first = runs.find((item) => item.text.length)?.style ?? {};
  const descriptor = (run: PenpotTextNode) => {
    const name = fontName(run);
    fonts.add(name);
    return { _class: "fontDescriptor", attributes: { name, size: Math.max(1, num(run.fontSize, 14)) } };
  };
  const paragraph = (run: PenpotTextNode) => {
    const size = Math.max(1, num(run.fontSize, 14));
    const line = num(run.lineHeight, 1.2);
    const pixels = line <= 4 ? line * size : line;
    return { _class: "paragraphStyle", alignment: textAlign(run.textAlign), maximumLineHeight: pixels, minimumLineHeight: pixels };
  };
  let location = 0;
  const attributes = runs.filter((item) => item.text.length).map((item) => {
    const result = {
      _class: "stringAttribute",
      location,
      length: item.text.length,
      attributes: {
        kerning: num(item.style.letterSpacing),
        textStyleVerticalAlignmentKey: verticalAlign((shape.content as PenpotTextNode | undefined)?.verticalAlign),
        MSAttributedStringFontAttribute: descriptor(item.style),
        MSAttributedStringColorAttribute: textColor(item.style),
        paragraphStyle: paragraph(item.style),
      },
    };
    location += item.text.length;
    return result;
  });
  const textStyle = {
    _class: "textStyle",
    verticalAlignment: verticalAlign((shape.content as PenpotTextNode | undefined)?.verticalAlign),
    encodedAttributes: {
      paragraphStyle: paragraph(first),
      kerning: num(first.letterSpacing),
      MSAttributedStringFontAttribute: descriptor(first),
      MSAttributedStringColorAttribute: textColor(first),
      textStyleVerticalAlignmentKey: verticalAlign((shape.content as PenpotTextNode | undefined)?.verticalAlign),
    },
  };
  const box = bounds(shape);
  return {
    ...baseLayer(shape, parentBox),
    _class: "text",
    style: makeStyle(shape, images, textStyle),
    attributedString: { _class: "attributedString", string: fullText, attributes },
    automaticallyDrawOnUnderlyingPath: false,
    dontSynchroniseWithSymbol: false,
    glyphBounds: `{{0, 0}, {${box.width}, ${box.height}}}`,
    lineSpacingBehaviour: 2,
    textBehaviour: shape.growType === "auto-width" ? 0 : shape.growType === "auto-height" ? 1 : 2,
  };
};

const primitiveLayer = (shape: PenpotShape, parentBox: Bounds | undefined, images: Map<string, string>) => {
  const imageFill = shape.fills?.find((fill) => fill.fillImage?.id && images.has(fill.fillImage.id));
  if (imageFill?.fillImage?.id) {
    const imagePath = images.get(imageFill.fillImage.id)!;
    return {
      ...baseLayer(shape, parentBox),
      _class: "bitmap",
      style: makeStyle({ ...shape, fills: shape.fills?.filter((fill) => fill !== imageFill) }, images),
      clippingMask: "{{0, 0}, {1, 1}}",
      fillReplacesImage: false,
      image: imageRef(imagePath),
      intendedDPI: 0,
    };
  }
  const isEllipse = shape.type === "circle";
  return {
    ...baseLayer(shape, parentBox),
    _class: isEllipse ? "oval" : "rectangle",
    style: makeStyle(shape, images),
    edited: false,
    isClosed: true,
    pointRadiusBehaviour: 1,
    points: isEllipse ? ellipsePoints(shape) : rectangularPoints(shape),
    fixedRadius: isEllipse ? 0 : Math.max(num(shape.r1), num(shape.r2), num(shape.r3), num(shape.r4)),
    needsConvertionToNewRoundCorners: false,
    hasConvertedToNewRoundCorners: true,
  };
};

const backgroundShape = (shape: PenpotShape): PenpotShape => ({
  ...shape,
  id: uuid(),
  name: `${shape.name} — Background`,
  type: "rect",
  strokes: [],
  shadow: [],
  blur: undefined,
  opacity: 1,
});

const hasVisiblePaint = (shape: PenpotShape) =>
  (shape.fills?.length ?? 0) > 0 || (shape.strokes?.length ?? 0) > 0;

const paintedDescendant = (
  shape: PenpotShape,
  shapes: Map<string, PenpotShape>,
  visited = new Set<string>(),
): PenpotShape | undefined => {
  if (visited.has(shape.id)) return undefined;
  visited.add(shape.id);
  for (const childId of shape.shapes ?? []) {
    const child = shapes.get(childId);
    if (!child) continue;
    if (hasVisiblePaint(child)) return child;
    const nested = paintedDescendant(child, shapes, visited);
    if (nested) return nested;
  }
  return undefined;
};

const booleanWithInheritedPaint = (shape: PenpotShape, shapes: Map<string, PenpotShape>) => {
  if (hasVisiblePaint(shape)) return shape;
  const donor = paintedDescendant(shape, shapes);
  if (!donor) return shape;
  return {
    ...shape,
    fills: donor.fills,
    strokes: donor.strokes,
  };
};

const convertShape = (
  shape: PenpotShape,
  shapes: Map<string, PenpotShape>,
  parentBox: Bounds | undefined,
  images: Map<string, string>,
  fonts: Set<string>,
  count: { value: number },
): Json[] => {
  count.value += 1;
  if (shape.type === "path") return pathLayers(shape, parentBox, images);
  if (shape.type === "bool") return pathLayers(booleanWithInheritedPaint(shape, shapes), parentBox, images);
  if (shape.type === "text") return [textLayer(shape, parentBox, images, fonts)];
  if (shape.type === "rect" || shape.type === "image" || shape.type === "circle") return [primitiveLayer(shape, parentBox, images)];

  const box = bounds(shape);
  const children: Json[] = [];
  if ((shape.fills?.length ?? 0) > 0 || (shape.strokes?.length ?? 0) > 0) {
    children.push(primitiveLayer(backgroundShape(shape), box, images));
  }
  for (const childId of shape.shapes ?? []) {
    const child = shapes.get(childId);
    if (child) children.push(...convertShape(child, shapes, box, images, fonts, count));
  }
  if (shape.maskedGroup && children[0]) {
    children[0].hasClippingMask = true;
    children[0].clippingMaskMode = 0;
  }
  if (shape.type === "frame" && shape.clipContent) {
    // Sketch groups have no frame clipping flag. An explicit mask preserves
    // Penpot board crops without turning the children into a boolean shape.
    const mask = primitiveLayer({
      ...backgroundShape(shape),
      name: `${shape.name} — Clip`,
      fills: [{ fillColor: "#ffffff" }],
    }, box, images);
    mask.hasClippingMask = true;
    mask.clippingMaskMode = 0;
    children.unshift(mask);
  }
  return [{
    ...baseLayer(shape, parentBox),
    // shapeGroup is a compound vector, not an organisational container:
    // Figma otherwise drops child paints and nested bitmaps on import.
    _class: "group",
    style: makeStyle({ ...shape, fills: [], strokes: [], shadow: [], blur: undefined }, images),
    hasClickThrough: false,
    groupLayout: { _class: "MSImmutableFreeformGroupLayout" },
    layers: children,
  }];
};

const readJson = async <T>(zip: JSZip, path: string): Promise<T> => {
  const entry = zip.file(path);
  if (!entry) throw new Error(`В исходном Penpot-файле не найден ${path}.`);
  return JSON.parse(await entry.async("string")) as T;
};

const mediaExtension = (mtype?: string) => {
  const normalized = String(mtype ?? "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("svg")) return "svg";
  return "png";
};

const sha1 = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-1", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
};

const emptyPageStyle = () => makeStyle({ id: uuid(), name: "Page", type: "frame", fills: [], strokes: [] }, new Map());

export const convertPenpotToSketch = async (input: Uint8Array, options: ConvertOptions = {}) => {
  const source = await JSZip.loadAsync(input);
  options.onProgress?.(5, "Читаю структуру Penpot…");
  const manifest = await readJson<PenpotManifest>(source, "manifest.json");
  const file = manifest.files[0];
  if (!file) throw new Error("В архиве Penpot нет файла проекта.");
  const fileId = file.id;

  const pageEntries = Object.keys(source.files).filter((path) =>
    path.startsWith(`files/${fileId}/pages/`) && path.endsWith(".json") && path.split("/").length === 4,
  );
  const pages = await Promise.all(pageEntries.map((path) => readJson<PenpotPage>(source, path)));
  const pageInfo = pages.find((item) => item.id === options.pageId) ?? pages.sort((a, b) => num(a.index) - num(b.index))[0];
  if (!pageInfo) throw new Error("В исходном файле Penpot не найдена страница.");

  const shapePrefix = `files/${fileId}/pages/${pageInfo.id}/`;
  const shapeEntries = Object.keys(source.files).filter((path) => path.startsWith(shapePrefix) && path.endsWith(".json"));
  const shapeList = await Promise.all(shapeEntries.map((path) => readJson<PenpotShape>(source, path)));
  const shapes = new Map(shapeList.map((shape) => [shape.id, shape]));
  const root = shapes.get("00000000-0000-0000-0000-000000000000");
  if (!root) throw new Error("В исходном файле Penpot не найден корневой холст.");
  const requested = options.rootIds?.length ? options.rootIds : root.shapes ?? [];
  const roots = requested.map((id) => shapes.get(id)).filter((item): item is PenpotShape => Boolean(item));
  if (!roots.length) throw new Error("На выбранной странице нет экспортируемых артбордов.");

  const selectedIds = new Set<string>();
  const visit = (shape: PenpotShape) => {
    if (selectedIds.has(shape.id)) return;
    selectedIds.add(shape.id);
    for (const childId of shape.shapes ?? []) {
      const child = shapes.get(childId);
      if (child) visit(child);
    }
  };
  roots.forEach(visit);

  options.onProgress?.(15, "Встраиваю изображения…");
  const imageIds = new Set<string>();
  for (const id of selectedIds) {
    const shape = shapes.get(id);
    for (const fill of shape?.fills ?? []) if (fill.fillImage?.id) imageIds.add(fill.fillImage.id);
  }
  const output = new JSZip();
  const images = new Map<string, string>();
  for (const [index, id] of Array.from(imageIds).entries()) {
    const media = await readJson<PenpotMedia>(source, `files/${fileId}/media/${id}.json`);
    const ext = mediaExtension(media.mtype);
    const objectPath = `objects/${media.mediaId}.${ext}`;
    const object = source.file(objectPath);
    if (!object) throw new Error(`Не удалось встроить изображение ${media.name || id}.`);
    const objectBytes = await object.async("uint8array");
    const sketchPath = `images/${await sha1(objectBytes)}.${ext}`;
    output.file(sketchPath, objectBytes, { binary: true });
    images.set(id, sketchPath);
    options.onProgress?.(15 + ((index + 1) / Math.max(1, imageIds.size)) * 20, `Встраиваю изображения: ${index + 1}/${imageIds.size}`);
  }

  options.onProgress?.(40, "Преобразую слои и векторные объекты…");
  const fonts = new Set<string>();
  const count = { value: 0 };
  const artboards = roots.map((shape) => {
    const box = bounds(shape);
    const solid = shape.fills?.find((fill) => fill.fillColor && !fill.fillImage && !fill.fillColorGradient);
    const complexBackground = (shape.fills?.length ?? 0) > (solid ? 1 : 0) || shape.fills?.some((fill) => fill.fillImage || fill.fillColorGradient);
    const layers: Json[] = [];
    if (complexBackground) layers.push(primitiveLayer(backgroundShape(shape), box, images));
    for (const childId of shape.shapes ?? []) {
      const child = shapes.get(childId);
      if (child) layers.push(...convertShape(child, shapes, box, images, fonts, count));
    }
    return {
      ...baseLayer(shape),
      _class: "artboard",
      frame: { ...rect(box), x: box.x, y: box.y },
      shouldBreakMaskChain: true,
      style: makeStyle({ ...shape, fills: [], strokes: [], shadow: [], blur: undefined }, images),
      hasClickThrough: false,
      groupLayout: { _class: "MSImmutableFreeformGroupLayout" },
      layers,
      hasBackgroundColor: Boolean(solid),
      includeBackgroundColorInExport: true,
      includeInCloudUpload: true,
      isFlowHome: false,
      presetDictionary: {},
      resizesContent: false,
      backgroundColor: color(solid?.fillColor ?? "#ffffff", solid?.fillOpacity ?? 1),
      horizontalRulerData: { _class: "rulerData", base: 0, guides: [] },
      verticalRulerData: { _class: "rulerData", base: 0, guides: [] },
    };
  });

  const pageId = uuid();
  const documentId = uuid();
  const page = {
    _class: "page",
    do_objectID: pageId,
    booleanOperation: -1,
    isFixedToViewport: false,
    isFlippedHorizontal: false,
    isFlippedVertical: false,
    isLocked: false,
    isVisible: true,
    layerListExpandedType: 0,
    maintainScrollPosition: false,
    name: pageInfo.name,
    nameIsFixed: false,
    resizingConstraint: 63,
    resizingType: 0,
    rotation: 0,
    shouldBreakMaskChain: false,
    exportOptions: exportOptions(),
    frame: { _class: "rect", constrainProportions: false, height: 0, width: 0, x: 0, y: 0 },
    clippingMaskMode: 0,
    hasClippingMask: false,
    style: emptyPageStyle(),
    hasClickThrough: true,
    groupLayout: { _class: "MSImmutableFreeformGroupLayout" },
    layers: artboards,
    includeInCloudUpload: true,
    horizontalRulerData: { _class: "rulerData", base: 0, guides: [] },
    verticalRulerData: { _class: "rulerData", base: 0, guides: [] },
  };
  const document = {
    _class: "document",
    do_objectID: documentId,
    colorSpace: 0,
    currentPageIndex: 0,
    assets: {
      _class: "assetCollection",
      do_objectID: uuid(),
      images: [],
      colorAssets: [],
      exportPresets: [],
      gradientAssets: [],
      imageCollection: { _class: "imageCollection", images: {} },
      colors: [],
      gradients: [],
    },
    foreignLayerStyles: [],
    foreignSymbols: [],
    foreignTextStyles: [],
    layerStyles: { _class: "sharedStyleContainer", objects: [] },
    layerSymbols: { _class: "symbolContainer", objects: [] },
    layerTextStyles: { _class: "sharedTextStyleContainer", objects: [] },
    pages: [{ _class: "MSJSONFileReference", _ref_class: "MSImmutablePage", _ref: `pages/${pageId}` }],
  };
  const created = {
    commit: "263281c53601afed11c5ffc64635380925727011",
    appVersion: "59",
    build: 89581,
    app: "com.bohemiancoding.sketch3",
    compatibilityVersion: 99,
    version: 121,
    variant: "NONAPPSTORE",
  };
  const meta = {
    commit: created.commit,
    pagesAndArtboards: {
      [pageId]: {
        name: pageInfo.name,
        artboards: Object.fromEntries(artboards.map((item) => [item.do_objectID, { name: item.name }])),
      },
    },
    version: 121,
    fonts: Array.from(fonts).sort(),
    compatibilityVersion: 99,
    app: created.app,
    autosaved: 0,
    variant: created.variant,
    created,
    saveHistory: ["NONAPPSTORE.89581"],
    appVersion: created.appVersion,
    build: created.build,
  };
  const user = {
    document: { pageListHeight: 85, pageListCollapsed: 0 },
    [pageId]: { scrollOrigin: "{0, 0}", zoomValue: 0.25 },
  };

  output.file("document.json", JSON.stringify(document));
  output.file("meta.json", JSON.stringify(meta));
  output.file("user.json", JSON.stringify(user));
  output.file(`pages/${pageId}.json`, JSON.stringify(page));
  options.onProgress?.(90, "Упаковываю один Sketch-файл…");
  const bytes = await output.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  options.onProgress?.(100, "Sketch-файл готов.");
  return {
    bytes,
    pageName: pageInfo.name,
    report: { layers: count.value, images: images.size, artboards: artboards.length, fonts: Array.from(fonts).sort() },
  };
};

export const convertPenpotGraphToSketch = async (graph: PenpotGraph, onProgress?: ConvertOptions["onProgress"]) => {
  onProgress?.(2, "Собираю выбранные артборды…");
  const source = new JSZip();
  source.file("manifest.json", JSON.stringify({
    generatedBy: "Export to Figma (.sketch)",
    files: [{ id: graph.fileId, name: graph.fileName }],
  } satisfies PenpotManifest));
  source.file(`files/${graph.fileId}/pages/${graph.pageId}.json`, JSON.stringify({
    id: graph.pageId,
    name: graph.pageName,
    index: 0,
  } satisfies PenpotPage));
  source.file(`files/${graph.fileId}/pages/${graph.pageId}/00000000-0000-0000-0000-000000000000.json`, JSON.stringify({
    id: "00000000-0000-0000-0000-000000000000",
    name: "Root",
    type: "group",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    shapes: graph.rootIds,
    fills: [],
    strokes: [],
  } satisfies PenpotShape));
  for (const shape of graph.shapes) {
    source.file(`files/${graph.fileId}/pages/${graph.pageId}/${shape.id}.json`, JSON.stringify(shape));
  }
  for (const media of graph.media) {
    const extension = mediaExtension(media.mtype);
    source.file(`files/${graph.fileId}/media/${media.id}.json`, JSON.stringify({
      id: media.id,
      mediaId: media.id,
      mtype: media.mtype ?? "image/png",
      name: media.name,
    } satisfies PenpotMedia));
    source.file(`objects/${media.id}.${extension}`, media.bytes, { binary: true });
  }
  const bytes = await source.generateAsync({ type: "uint8array", compression: "STORE" });
  return convertPenpotToSketch(bytes, {
    pageId: graph.pageId,
    rootIds: graph.rootIds,
    onProgress,
  });
};
