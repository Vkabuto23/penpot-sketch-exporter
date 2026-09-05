import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { convertPenpotGraphToSketch } from "../src/sketch-converter.ts";

const shape = (id, type, extra = {}) => ({
  id, type, name: id, x: 100, y: 200, width: 80, height: 60,
  fills: [], strokes: [], ...extra,
});
const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
async function convert(shapes, media = []) {
  const graph = {
    fileId: "file", fileName: "Regression", pageId: "page", pageName: "Groups",
    rootIds: ["board"], shapes: [shape("board", "frame", {
      x: 0, y: 0, width: 400, height: 800, shapes: [shapes[0].id],
    }), ...shapes], media,
  };
  const before = structuredClone(graph);
  const result = await convertPenpotGraphToSketch(graph);
  assert.deepEqual(graph, before, "conversion must not mutate the source");
  const zip = await JSZip.loadAsync(result.bytes);
  const entry = Object.keys(zip.files).find(name => /^pages\/.+\.json$/.test(name));
  const page = JSON.parse(await zip.file(entry).async("string"));
  return { layer: page.layers[0].layers[0], zip };
}

test("ordinary nested icon groups preserve independent fill and stroke paints", async () => {
  const { layer } = await convert([
    shape("icon", "group", { shapes: ["nested"], opacity: 0.7 }),
    shape("nested", "group", { shapes: ["filled", "stroked"] }),
    shape("filled", "path", { content: "M100 200L120 200L120 220Z", fills: [{ fillColor: "#2455aa" }] }),
    shape("stroked", "path", { content: "M100 200L120 220", strokes: [{ strokeColor: "#112233", strokeWidth: 2 }] }),
  ]);
  assert.equal(layer._class, "group");
  assert.equal(layer.style.contextSettings.opacity, 0.7);
  assert.equal(layer.layers[0]._class, "group");
  const [filled, stroked] = layer.layers[0].layers;
  assert.equal(filled._class, "shapePath");
  assert.equal(filled.style.fills[0].color.blue, 170 / 255);
  assert.equal(stroked.style.borders[0].thickness, 2);
  assert.equal(stroked.style.fills.length, 0);
});

test("bitmap and its bytes survive inside an ordinary group", async () => {
  const { layer, zip } = await convert([
    shape("photo-container", "group", { shapes: ["photo", "label"] }),
    shape("photo", "image", { x: 90, fills: [{ fillImage: { id: "asset" } }] }),
    shape("label", "text", { content: { text: "Editable", fontFamily: "Manrope", fontSize: 16 } }),
  ], [{ id: "asset", bytes: png, mtype: "image/png" }]);
  assert.equal(layer._class, "group");
  assert.equal(layer.layers[0]._class, "bitmap");
  assert.equal(layer.layers[0].frame.x, -10);
  assert.deepEqual(await zip.file(layer.layers[0].image._ref).async("uint8array"), png);
  assert.equal(layer.layers[1]._class, "text");
});

test("clipped nested boards get an explicit local mask, keeping image overflow cropped", async () => {
  const { layer } = await convert([
    shape("scene", "frame", { clipContent: true, shapes: ["photo"], fills: [{ fillColor: "#102030" }] }),
    shape("photo", "image", { x: 50, width: 200, fills: [{ fillImage: { id: "asset" } }] }),
  ], [{ id: "asset", bytes: png, mtype: "image/png" }]);
  assert.equal(layer._class, "group");
  assert.equal(layer.layers.length, 3);
  const mask = layer.layers[0];
  assert.equal(mask.hasClippingMask, true);
  assert.equal(mask.frame.x, 0);
  assert.equal(mask.frame.y, 0);
  assert.equal(mask.frame.width, 80);
  assert.equal(mask.frame.height, 60);
  assert.equal(layer.layers[2]._class, "bitmap");
  assert.equal(layer.layers[2].frame.x, -50);
});

test("unclipped boards do not acquire a mask", async () => {
  const { layer } = await convert([
    shape("scene", "frame", { clipContent: false, shapes: ["rect"] }),
    shape("rect", "rect", { fills: [{ fillColor: "#ff0000" }] }),
  ]);
  assert.equal(layer._class, "group");
  assert.equal(layer.layers.length, 1);
  assert.equal(layer.layers[0].hasClippingMask, false);
});

test("actual boolean objects remain painted paths, not container groups", async () => {
  const { layer } = await convert([
    shape("boolean", "bool", { shapes: ["source"], content: "M100 200L120 200L120 220Z" }),
    shape("source", "path", { fills: [{ fillColor: "#2455aa" }] }),
  ]);
  assert.equal(layer._class, "shapePath");
  assert.equal(layer.style.fills[0].color.blue, 170 / 255);
});

test("Bezier handles match Sketch's official fromSVGPath reference document", async () => {
  // Golden source and normalised handles from:
  // https://github.com/sketch-hq/sketch-reference-files/blob/master/features/shape-paths.js
  // files/118/shape-paths/pages/3A993D78-954D-4474-A395-5A0C82A9D574.json
  const { layer } = await convert([shape("curve", "path", {
    x:100,y:175,width:200,height:250,
    content:"M100 300Q150 50 200 300Q250 550 300 300",
    fills:[{fillColor:"#00ff00"}],
  })]);
  const [a,b,c]=layer.points;
  assert.equal(a.point,"{0, 0.5}");
  assert.equal(a.curveFrom,"{0.166667, -0.166667}");
  assert.equal(a.hasCurveFrom,true);
  assert.equal(a.hasCurveTo,false);
  assert.equal(b.curveTo,"{0.333333, -0.166667}");
  assert.equal(b.curveFrom,"{0.666667, 1.166667}");
  assert.equal(c.curveTo,"{0.833333, 1.166667}");
  assert.equal(c.hasCurveFrom,false);
});

test("cubic outlined strips keep handles on the correct edges", async () => {
  const { layer }=await convert([shape("strip","path",{
    x:0,y:0,width:9,height:2,
    content:"M0 2C3 2 6 2 9 2L9 0C6 0 3 0 0 0Z",
    fills:[{fillColor:"#234f8c"}],
  })]);
  assert.equal(layer.points[0].curveFrom,"{0.333333, 1}");
  assert.equal(layer.points[1].curveTo,"{0.666667, 1}");
  assert.equal(layer.points[2].curveFrom,"{0.666667, 0}");
  assert.equal(layer.points[3].curveTo,"{0.333333, 0}");
});

test("oval handles leave each anchor towards the next clockwise anchor", async () => {
  const { layer }=await convert([shape("circle","circle")]);
  assert.equal(layer.points[0].curveFrom,"{0.776142, 0}");
  assert.equal(layer.points[1].curveTo,"{1, 0.223858}");
});

test("multiple contours of a single path retain a hole in one painted compound", async () => {
  const { layer }=await convert([shape("ring","path",{
    x:100,y:200,width:40,height:40,opacity:0.8,
    content:"M100 200L140 200L140 240L100 240ZM110 210L110 230L130 230L130 210Z",
    fills:[{fillColor:"#234f8c"}],
  })]);
  assert.equal(layer._class,"shapeGroup");
  assert.equal(layer.style.fills.length,1);
  assert.equal(layer.style.contextSettings.opacity,0.8);
  assert.equal(layer.windingRule,1);
  assert.equal(layer.layers.length,2);
  assert.equal(new Set([layer.do_objectID,...layer.layers.map(p=>p.do_objectID)]).size,3);
  for(const contour of layer.layers){
    assert.equal(contour._class,"shapePath");
    assert.equal(contour.frame.x,0);
    assert.equal(contour.frame.y,0);
    assert.equal(contour.style.fills.length,0);
    assert.equal(contour.style.contextSettings.opacity,1);
  }
});
