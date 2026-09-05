import "./style.css";
import { convertPenpotGraphToSketch, type PenpotGraph, type PenpotGraphMedia } from "./sketch-converter";
import type { PenpotShape } from "./penpot-format";

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
let incomingGraph: Omit<PenpotGraph, "shapes" | "media"> & { totalShapes: number; totalMedia: number } | null = null;
let incomingShapes: PenpotShape[] = [];
let incomingMedia: PenpotGraphMedia[] = [];
let currentMedia: (Omit<PenpotGraphMedia, "bytes"> & { totalChunks: number; totalBytes: number; chunks: Uint8Array[] }) | null = null;

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
    };
    incomingShapes = [];
    incomingMedia = [];
    currentMedia = null;
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
  if (message.type !== "graph-end" || !incomingGraph) return;
  try {
    if (incomingShapes.length !== incomingGraph.totalShapes) throw new Error("Не все слои были переданы из Penpot.");
    if (incomingMedia.length !== incomingGraph.totalMedia) throw new Error("Не все изображения были переданы из Penpot.");
    progressNode.value = 50;
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
      progressNode.value = 50 + value * 0.49;
      setStatus(label);
    });
    const blob = new Blob([result.bytes as BlobPart], { type: "application/zip" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${String(incomingGraph.fileName || fileName).replace(/[\\/:*?\"<>|]+/g, "-")} — ${result.pageName}.sketch`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    progressNode.value = 100;
    setStatus(`Готово: ${result.report.layers} слоёв, ${result.report.images} изображений.`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    incomingGraph = null;
    incomingShapes = [];
    incomingMedia = [];
    currentMedia = null;
    exportButton.disabled = false;
  }
});

const params = new URLSearchParams(window.location.search);
document.body.dataset.theme = params.get("theme") ?? "light";
parent.postMessage({ type: "ready" }, "*");
