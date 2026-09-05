import "./style.css";
import { convertPenpotGraphToSketch, type PenpotGraph, type PenpotGraphMedia } from "./sketch-converter";
import type { PenpotShape } from "./penpot-format";
import { PDFDocument } from "pdf-lib";

type RootInfo = { id: string; name: string; type: string; width: number; height: number };
type PageInfo = { id: string; name: string };

const fileNameNode = document.querySelector<HTMLElement>("#file-name")!;
const pageNameNode = document.querySelector<HTMLElement>("#page-name")!;
const rootsNode = document.querySelector<HTMLElement>("#roots")!;
const statusNode = document.querySelector<HTMLElement>("#status")!;
const progressNode = document.querySelector<HTMLProgressElement>("#progress")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export")!;

let pageId = "";
let fileName = "Penpot export";
type PreviewAsset = {
  id: string;
  format: "svg" | "pdf";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  bytes: Uint8Array;
};

let incomingGraph: Omit<PenpotGraph, "shapes" | "media"> & { totalShapes: number; totalMedia: number; totalPreviews: number } | null = null;
let incomingShapes: PenpotShape[] = [];
let incomingMedia: PenpotGraphMedia[] = [];
let currentMedia: (Omit<PenpotGraphMedia, "bytes"> & { totalChunks: number; totalBytes: number; chunks: Uint8Array[] }) | null = null;
let incomingPreviews: PreviewAsset[] = [];
let currentPreview: (Omit<PreviewAsset, "bytes"> & { totalChunks: number; totalBytes: number; chunks: Uint8Array[] }) | null = null;

const safeName = (value: string) => value.replace(/[\\/:*?"<>|]+/g, "-").trim();
const download = (bytes: Uint8Array, name: string, type: string) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
};

const base64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + chunkSize)));
  }
  return btoa(binary);
};

const combinedSvg = (assets: PreviewAsset[]) => {
  const minX = Math.min(...assets.map((item) => item.x));
  const minY = Math.min(...assets.map((item) => item.y));
  const maxX = Math.max(...assets.map((item) => item.x + item.width));
  const maxY = Math.max(...assets.map((item) => item.y + item.height));
  const width = maxX - minX;
  const height = maxY - minY;
  const images = assets.map((item) =>
    `<image x="${item.x - minX}" y="${item.y - minY}" width="${item.width}" height="${item.height}" href="data:image/png;base64,${base64(item.bytes)}"/>`,
  ).join("\n");
  return new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${images}\n</svg>`);
};

const combinedPdf = async (assets: PreviewAsset[]) => {
  const output = await PDFDocument.create();
  for (const asset of assets) {
    const source = await PDFDocument.load(asset.bytes);
    const pages = await output.copyPages(source, source.getPageIndices());
    for (const page of pages) output.addPage(page);
  }
  return output.save();
};

const setStatus = (message: string, kind: "normal" | "error" | "success" = "normal") => {
  statusNode.textContent = message;
  statusNode.dataset.kind = kind;
};

const updateButton = () => {
  exportButton.disabled = rootsNode.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked').length === 0;
};

const renderRoots = (roots: RootInfo[]) => {
  rootsNode.innerHTML = "";
  for (const root of roots) {
    const row = document.createElement("label");
    row.className = "root-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = root.id;
    checkbox.checked = root.type === "board";
    checkbox.addEventListener("change", updateButton);
    const label = document.createElement("span");
    label.className = "root-name";
    label.textContent = root.name || root.type;
    const size = document.createElement("span");
    size.className = "root-size";
    size.textContent = `${Math.round(root.width)}×${Math.round(root.height)}`;
    row.append(checkbox, label, size);
    rootsNode.append(row);
  }
  updateButton();
};

exportButton.addEventListener("click", () => {
  const rootIds = Array.from(rootsNode.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map((item) => item.value);
  exportButton.disabled = true;
  progressNode.hidden = false;
  progressNode.value = 5;
  setStatus("Подготавливаю проект…");
  parent.postMessage({ type: "request-export", pageId, rootIds }, "*");
});

window.addEventListener("message", async (event) => {
  const message = event.data;
  if (!message || message.source !== "penpot") return;
  if (message.type === "themechange") {
    document.body.dataset.theme = message.theme;
    return;
  }
  if (message.type === "document-info") {
    fileName = message.fileName;
    pageId = message.currentPageId;
    fileNameNode.textContent = fileName;
    pageNameNode.textContent = (message.pages as PageInfo[]).find((item) => item.id === pageId)?.name ?? "Текущая страница";
    renderRoots(message.roots as RootInfo[]);
    return;
  }
  if (message.type === "status") {
    setStatus(message.message);
    return;
  }
  if (message.type === "error") {
    setStatus(message.message, "error");
    progressNode.hidden = true;
    updateButton();
    return;
  }
  if (message.type === "graph-start") {
    incomingGraph = {
      fileId: message.fileId,
      fileName: message.fileName,
      pageId: message.pageId,
      pageName: message.pageName,
      rootIds: message.rootIds,
      totalShapes: message.totalShapes,
      totalMedia: message.totalMedia,
      totalPreviews: message.totalPreviews,
    };
    incomingShapes = [];
    incomingMedia = [];
    currentMedia = null;
    incomingPreviews = [];
    currentPreview = null;
    progressNode.value = 10;
    setStatus(`Передаю слои: 0/${message.totalShapes}…`);
    return;
  }
  if (message.type === "shape-batch") {
    if (!incomingGraph) return;
    incomingShapes.push(...message.shapes as PenpotShape[]);
    progressNode.value = 10 + (incomingShapes.length / Math.max(1, incomingGraph.totalShapes)) * 15;
    setStatus(`Передаю слои: ${incomingShapes.length}/${incomingGraph.totalShapes}…`);
    return;
  }
  if (message.type === "media-start") {
    currentMedia = {
      id: message.id,
      name: message.name,
      width: message.width,
      height: message.height,
      mtype: message.mtype,
      totalChunks: message.totalChunks,
      totalBytes: message.totalBytes,
      chunks: new Array(message.totalChunks),
    };
    return;
  }
  if (message.type === "media-chunk") {
    if (!currentMedia || currentMedia.id !== message.id) return;
    currentMedia.chunks[message.index] = new Uint8Array(message.bytes);
    return;
  }
  if (message.type === "media-end") {
    if (!currentMedia || currentMedia.id !== message.id || !incomingGraph) return;
    const bytes = new Uint8Array(currentMedia.totalBytes);
    let offset = 0;
    for (const chunk of currentMedia.chunks) {
      if (!chunk) throw new Error(`Не полностью передано изображение ${currentMedia.name || currentMedia.id}.`);
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    incomingMedia.push({
      id: currentMedia.id,
      name: currentMedia.name,
      width: currentMedia.width,
      height: currentMedia.height,
      mtype: currentMedia.mtype,
      bytes,
    });
    currentMedia = null;
    progressNode.value = 25 + (incomingMedia.length / Math.max(1, incomingGraph.totalMedia)) * 25;
    setStatus(`Встроено изображений: ${incomingMedia.length}/${incomingGraph.totalMedia}…`);
    return;
  }
  if (message.type === "preview-start") {
    currentPreview = {
      id: message.id,
      format: message.format,
      name: message.name,
      x: message.x,
      y: message.y,
      width: message.width,
      height: message.height,
      totalChunks: message.totalChunks,
      totalBytes: message.totalBytes,
      chunks: new Array(message.totalChunks),
    };
    return;
  }
  if (message.type === "preview-chunk") {
    if (!currentPreview || currentPreview.id !== message.id) return;
    currentPreview.chunks[message.index] = new Uint8Array(message.bytes);
    return;
  }
  if (message.type === "preview-end") {
    if (!currentPreview || currentPreview.id !== message.id || !incomingGraph) return;
    const bytes = new Uint8Array(currentPreview.totalBytes);
    let offset = 0;
    for (const chunk of currentPreview.chunks) {
      if (!chunk) throw new Error(`Не полностью передан ${currentPreview.format.toUpperCase()} для ${currentPreview.name}.`);
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    incomingPreviews.push({
      id: currentPreview.id,
      format: currentPreview.format,
      name: currentPreview.name,
      x: currentPreview.x,
      y: currentPreview.y,
      width: currentPreview.width,
      height: currentPreview.height,
      bytes,
    });
    currentPreview = null;
    progressNode.value = 50 + (incomingPreviews.length / Math.max(1, incomingGraph.totalPreviews)) * 15;
    return;
  }
  if (message.type !== "graph-end" || !incomingGraph) return;
  try {
    if (incomingShapes.length !== incomingGraph.totalShapes) throw new Error("Не все слои были переданы из Penpot.");
    if (incomingMedia.length !== incomingGraph.totalMedia) throw new Error("Не все изображения были переданы из Penpot.");
    if (incomingPreviews.length !== incomingGraph.totalPreviews) throw new Error("Не все SVG/PDF-превью были переданы из Penpot.");
    progressNode.value = 65;
    setStatus("Собираю редактируемый Sketch-документ…");
    const result = await convertPenpotGraphToSketch({
      fileId: incomingGraph.fileId,
      fileName: incomingGraph.fileName,
      pageId: incomingGraph.pageId,
      pageName: incomingGraph.pageName,
      rootIds: incomingGraph.rootIds,
      shapes: incomingShapes,
      media: incomingMedia,
    }, (value, label) => {
      progressNode.value = 65 + value * 0.3;
      setStatus(label);
    });
    const prefix = `${safeName(incomingGraph.fileName || fileName)} — ${safeName(result.pageName)}`;
    const svg = combinedSvg(incomingPreviews.filter((item) => item.format === "svg"));
    const pdf = await combinedPdf(incomingPreviews.filter((item) => item.format === "pdf"));
    download(result.bytes, `${prefix}.sketch`, "application/zip");
    await new Promise((resolve) => setTimeout(resolve, 250));
    download(svg, `${prefix}.svg`, "image/svg+xml");
    await new Promise((resolve) => setTimeout(resolve, 250));
    download(pdf, `${prefix}.pdf`, "application/pdf");
    progressNode.value = 100;
    setStatus(`Готово: ${result.report.layers} слоёв, ${result.report.images} изображений.`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    incomingGraph = null;
    incomingShapes = [];
    incomingMedia = [];
    currentMedia = null;
    incomingPreviews = [];
    currentPreview = null;
    exportButton.disabled = false;
  }
});

const params = new URLSearchParams(window.location.search);
document.body.dataset.theme = params.get("theme") ?? "light";
parent.postMessage({ type: "ready" }, "*");
