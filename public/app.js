const fileInput = document.getElementById("fileInput");
const uploadDrop = document.getElementById("uploadDrop");
const imageList = document.getElementById("imageList");
const editorCanvas = document.getElementById("editorCanvas");
const selectionMeta = document.getElementById("selectionMeta");
const promptInput = document.getElementById("promptInput");
const styleInput = document.getElementById("styleInput");
const qualitySelect = document.getElementById("qualitySelect");
const sizeSelect = document.getElementById("sizeSelect");
const runEditBtn = document.getElementById("runEditBtn");
const runGenerateBtn = document.getElementById("runGenerateBtn");
const useResultBtn = document.getElementById("useResultBtn");
const downloadBtn = document.getElementById("downloadBtn");
const promptPreview = document.getElementById("promptPreview");
const statusText = document.getElementById("statusText");
const basePreview = document.getElementById("basePreview");
const resultPreview = document.getElementById("resultPreview");
const resultGallery = document.getElementById("resultGallery");

const ctx = editorCanvas.getContext("2d");
const IMAGE_MODEL = "gpt-image-1.5";
const DEFAULT_IMAGE_SIZE = "1024x1024";
const DEFAULT_USER_PROMPT = promptInput.value.trim();
const TEMP_DB_NAME = "xies-id-temp-store";
const TEMP_DB_VERSION = 1;
const TEMP_STORE_NAME = "sessions";
const TEMP_SESSION_KEY = "latest";
const TEMP_TTL_MS = 24 * 60 * 60 * 1000;

const DESIGN_RAG = {
  fixed:
    "RAG_FIXED: preserve structural columns, structural/load-bearing walls, beams, household shelter, shafts, windows, facade edges, plumbing stacks, AC ledge, door/window openings, and all visible dimension lines. Never hack, move, hide, resize, or reinterpret structural columns.",
  dimensions:
    "RAG_DIMENSIONS: follow the uploaded floorplan geometry and dimensions strictly. Keep room locations, wall thickness intent, circulation, door swings, and scale. Label proposed fixtures/furniture with practical dimensions in mm. If a dimension is missing, infer realistic HDB-safe dimensions and label them as proposed.",
  scope:
    "RAG_SCOPE: only change loose furniture, built-ins, storage, finishes, lighting, styling, and non-structural partitions. Keep circulation practical and avoid blocking access paths.",
  views: [
    {
      title: "2D layout plan",
      text:
        "OUTPUT_1_2D_PLAN: create a clean, top-down, dimensioned 2D interior layout plan. Preserve the exact uploaded floorplan geometry. Add furniture, cabinetry, non-structural partitions, labels, and proposed fixture dimensions in mm."
    },
    {
      title: "3D rendered view",
      text:
        "OUTPUT_2_3D_RENDER: create one polished 3D rendered perspective or axonometric view based on the same layout. Show materials, furniture, lighting, built-ins, and spatial atmosphere while preserving structural constraints."
    }
  ]
};

const state = {
  images: [],
  activeImageId: null,
  activeImageElement: null,
  activeImageDataUrl: null,
  selection: null,
  dragStart: null,
  viewRect: null,
  outputDataUrl: null,
  outputItems: [],
  busy: false
};

let tempSaveTimer = null;

fileInput.addEventListener("change", handleFileInput);
uploadDrop.addEventListener("dragover", (event) => {
  event.preventDefault();
});
uploadDrop.addEventListener("drop", handleFileDrop);
window.addEventListener("resize", renderCanvas);
editorCanvas.addEventListener("pointerdown", handlePointerDown);
window.addEventListener("pointermove", handlePointerMove);
window.addEventListener("pointerup", handlePointerUp);
runEditBtn.addEventListener("click", runImageEdit);
runGenerateBtn.addEventListener("click", runPromptGeneration);
useResultBtn.addEventListener("click", useResultAsBase);
downloadBtn.addEventListener("click", downloadResult);
promptInput.addEventListener("input", updatePromptPreview);
styleInput.addEventListener("change", updatePromptPreview);
promptInput.addEventListener("input", scheduleTempSave);
styleInput.addEventListener("change", saveTempSession);

function setStatus(text) {
  statusText.textContent = text;
}

function setBusy(busy) {
  state.busy = busy;
  runEditBtn.disabled = busy;
  runGenerateBtn.disabled = busy;
  fileInput.disabled = busy;
}

async function handleFileInput(event) {
  const files = Array.from(event.target.files || []);
  await processFiles(files);
  event.target.value = "";
}

async function handleFileDrop(event) {
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files || []);
  await processFiles(files);
}

async function processFiles(files) {
  if (!files.length) return;

  setStatus(`Loading ${files.length} image(s)...`);

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;

    const dataUrl = await fileToDataUrl(file);
    const img = await dataUrlToImage(dataUrl);
    const id = crypto.randomUUID();

    state.images.push({
      id,
      name: file.name,
      dataUrl,
      width: img.naturalWidth,
      height: img.naturalHeight
    });
  }

  renderImageList();

  if (!state.activeImageId && state.images[0]) {
    await setActiveImage(state.images[0].id);
  }

  saveTempSession();
  setStatus("Images loaded.");
}

function renderImageList() {
  imageList.innerHTML = "";

  for (const item of state.images) {
    const card = document.createElement("button");
    card.className = `image-card ${item.id === state.activeImageId ? "active" : ""}`;
    card.type = "button";

    const thumb = document.createElement("img");
    thumb.src = item.dataUrl;
    thumb.alt = item.name;

    const meta = document.createElement("div");
    meta.className = "image-meta";

    const name = document.createElement("strong");
    name.textContent = trimName(item.name, 28);

    const size = document.createElement("small");
    size.textContent = `${item.width} x ${item.height}`;

    meta.append(name, size);
    card.append(thumb, meta);

    card.addEventListener("click", () => setActiveImage(item.id));
    imageList.append(card);
  }
}

async function setActiveImage(imageId, options = {}) {
  const item = state.images.find((x) => x.id === imageId);
  if (!item) return;

  state.activeImageId = imageId;
  state.activeImageDataUrl = item.dataUrl;
  state.activeImageElement = await dataUrlToImage(item.dataUrl);
  state.selection = null;
  state.outputDataUrl = null;
  state.outputItems = [];

  resultPreview.removeAttribute("src");
  renderResultGallery([]);
  useResultBtn.disabled = true;
  downloadBtn.disabled = true;
  updatePromptPreview();

  basePreview.src = item.dataUrl;
  selectionMeta.textContent = "No selection yet.";

  renderImageList();
  renderCanvas();
  if (!options.skipSave) {
    saveTempSession();
  }
}

function renderCanvas() {
  if (!state.activeImageElement) {
    clearCanvas();
    return;
  }

  const image = state.activeImageElement;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = editorCanvas.clientWidth;
  const cssHeight = editorCanvas.clientHeight;

  editorCanvas.width = Math.floor(cssWidth * dpr);
  editorCanvas.height = Math.floor(cssHeight * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const fit = fitRect(image.naturalWidth, image.naturalHeight, cssWidth, cssHeight, 20);
  state.viewRect = fit;

  ctx.fillStyle = "#ebdfcc";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  ctx.drawImage(image, fit.x, fit.y, fit.width, fit.height);

  if (state.selection) {
    drawSelectionOverlay(state.selection, fit, cssWidth, cssHeight);
  }
}

function drawSelectionOverlay(selection, fit, canvasWidth, canvasHeight) {
  const sx = fit.x + (selection.x / state.activeImageElement.naturalWidth) * fit.width;
  const sy = fit.y + (selection.y / state.activeImageElement.naturalHeight) * fit.height;
  const sw = (selection.width / state.activeImageElement.naturalWidth) * fit.width;
  const sh = (selection.height / state.activeImageElement.naturalHeight) * fit.height;

  ctx.save();
  ctx.fillStyle = "rgba(32, 18, 9, 0.42)";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.clearRect(sx, sy, sw, sh);

  ctx.strokeStyle = "#ff9f59";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(sx, sy, sw, sh);
  ctx.restore();
}

function clearCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = editorCanvas.clientWidth;
  const cssHeight = editorCanvas.clientHeight;
  editorCanvas.width = Math.floor(cssWidth * dpr);
  editorCanvas.height = Math.floor(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#efe2ce";
  ctx.fillRect(0, 0, cssWidth, cssHeight);
}

function handlePointerDown(event) {
  if (!state.activeImageElement || !state.viewRect) return;

  event.preventDefault();
  const p = getCanvasPoint(event);
  if (!pointInRect(p.x, p.y, state.viewRect)) return;

  editorCanvas.setPointerCapture?.(event.pointerId);
  state.dragStart = canvasToImagePoint(p.x, p.y);
  state.selection = {
    x: state.dragStart.x,
    y: state.dragStart.y,
    width: 1,
    height: 1
  };

  renderCanvas();
}

function handlePointerMove(event) {
  if (!state.dragStart || !state.activeImageElement) return;

  event.preventDefault();
  const p = getCanvasPoint(event);
  const end = canvasToImagePoint(p.x, p.y);

  state.selection = normalizeSelection(state.dragStart.x, state.dragStart.y, end.x, end.y);
  updateSelectionMeta();
  renderCanvas();
}

function handlePointerUp(event) {
  if (!state.dragStart) return;

  try {
    editorCanvas.releasePointerCapture?.(event.pointerId);
  } catch {
    // Pointer may already be released when the drag ends outside the canvas.
  }
  state.dragStart = null;
  if (!state.selection || state.selection.width < 8 || state.selection.height < 8) {
    state.selection = null;
    selectionMeta.textContent = "Selection too small. Drag again.";
  } else {
    updateSelectionMeta();
  }

  renderCanvas();
}

function updateSelectionMeta() {
  if (!state.selection) {
    selectionMeta.textContent = "No selection yet.";
    return;
  }

  const s = state.selection;
  selectionMeta.textContent = `Selected region: x=${Math.round(s.x)}, y=${Math.round(s.y)}, width=${Math.round(s.width)}, height=${Math.round(s.height)}`;
}

async function runImageEdit() {
  if (state.busy) return;

  if (!state.activeImageDataUrl) {
    setStatus("Upload and select an image first.");
    return;
  }

  if (!state.selection) {
    setStatus("Select an edit area first.");
    return;
  }

  const rawPrompt = promptInput.value.trim();
  if (!rawPrompt) {
    setStatus("Write an edit prompt first.");
    return;
  }

  setBusy(true);
  setStatus("Building mask and sending request to OpenAI...");

  try {
    const maskDataUrl = createMaskFromSelection();
    const imageDataUrl = createPngDataUrlFromActiveImage();
    const prompt = buildDesignerPrompt(rawPrompt, {
      viewText:
        "VIEW_SELECTED_EDIT: edit only the transparent masked selection. Blend with the surrounding plan/render and keep all unselected areas unchanged.",
      useSelection: true
    });

    const payload = {
      imageDataUrl,
      maskDataUrl,
      prompt,
      imageModel: IMAGE_MODEL,
      quality: qualitySelect.value,
      size: getImageSize()
    };

    const response = await fetch("/api/edit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Edit request failed");
    }

    state.outputDataUrl = data.editedImageDataUrl;
    state.outputItems = [
      {
        title: "Selected area edit",
        dataUrl: data.editedImageDataUrl
      }
    ];
    resultPreview.src = state.outputDataUrl;
    renderResultGallery(state.outputItems);
    useResultBtn.disabled = false;
    downloadBtn.disabled = false;
    saveTempSession();

    if (data.revisedPrompt) {
      promptPreview.textContent = `Revised image prompt used by model:\n${data.revisedPrompt}`;
    }
    setStatus(data.requestId ? `Edit generated. Request ID: ${data.requestId}` : "Edit generated.");
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function runPromptGeneration() {
  if (state.busy) return;

  if (!state.activeImageDataUrl) {
    setStatus("Upload and select a floorplan image first.");
    return;
  }

  const rawPrompt = promptInput.value.trim();
  if (!rawPrompt) {
    setStatus("Write a prompt first.");
    return;
  }

  setBusy(true);
  setStatus("Generating 2 design images...");

  try {
    const prompts = buildDesignSetPrompts(rawPrompt);
    const outputs = [];
    const revisedPrompts = [];

    for (const [index, item] of prompts.entries()) {
      setStatus(`Generating ${index + 1} of ${prompts.length}...`);
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          imageDataUrl: state.activeImageDataUrl,
          prompt: item.prompt,
          imageModel: IMAGE_MODEL,
          quality: qualitySelect.value,
          size: getImageSize()
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Generation request failed");
      }

      outputs.push({
        title: item.title,
        dataUrl: data.generatedImageDataUrl
      });

      if (data.revisedPrompt) {
        revisedPrompts.push(`${item.title}:\n${data.revisedPrompt}`);
      }
    }

    state.outputDataUrl = outputs[0]?.dataUrl || null;
    state.outputItems = outputs;
    resultPreview.src = state.outputDataUrl;
    renderResultGallery(outputs);
    useResultBtn.disabled = false;
    downloadBtn.disabled = false;
    saveTempSession();
    if (revisedPrompts.length) {
      promptPreview.textContent = `Revised image prompt used by model:\n${revisedPrompts.join("\n\n")}`;
    }

    setStatus(
      outputs.length > 1
        ? `${outputs.length} images generated.`
        : "Image generated."
    );
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function buildDesignSetPrompts(rawPrompt) {
  return DESIGN_RAG.views.map((view) => ({
    title: view.title,
    prompt: buildDesignerPrompt(rawPrompt, { viewText: view.text })
  }));
}

function buildDesignerPrompt(rawPrompt, options = {}) {
  const selectionText = options.useSelection
    ? "Selection rule: apply changes only inside the selected masked area; preserve every unmasked pixel as much as possible."
    : "Image rule: use the uploaded floorplan as the source of truth for geometry, proportions, and fixed elements.";

  return [
    "You are an interior designer creating feasible HDB design visuals.",
    options.viewText,
    DESIGN_RAG.fixed,
    DESIGN_RAG.dimensions,
    DESIGN_RAG.scope,
    `STYLE: ${styleInput.value}.`,
    selectionText,
    `USER_PROMPT: ${rawPrompt}`
  ]
    .filter(Boolean)
    .join("\n");
}

function updatePromptPreview() {
  const rawPrompt = promptInput.value.trim() || "Write your design instruction here.";
  const imageNote = state.activeImageDataUrl
    ? "Active plan attached as visual context."
    : "Upload a plan before generating.";
  promptPreview.textContent = [
    imageNote,
    `Style: ${styleInput.value}`,
    "Outputs: 2 images (2D layout + 3D render)",
    "Model: GPT Image 1.5",
    "RAG layer: structural preservation + dimension fidelity + fixture dimension labels.",
    `Prompt: ${rawPrompt}`
  ].join("\n");
}

function getImageSize() {
  const supported = new Set(["1024x1024", "1536x1024", "1024x1536"]);
  return supported.has(sizeSelect.value) ? sizeSelect.value : DEFAULT_IMAGE_SIZE;
}

function renderResultGallery(items) {
  resultGallery.innerHTML = "";

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "result-card";

    const title = document.createElement("h3");
    title.textContent = item.title;

    const image = document.createElement("img");
    image.src = item.dataUrl;
    image.alt = item.title;

    card.append(title, image);
    resultGallery.append(card);
  }
}

function createMaskFromSelection() {
  const image = state.activeImageElement;
  const s = state.selection;

  const c = document.createElement("canvas");
  c.width = image.naturalWidth;
  c.height = image.naturalHeight;
  const cctx = c.getContext("2d");

  cctx.fillStyle = "rgba(0,0,0,1)";
  cctx.fillRect(0, 0, c.width, c.height);

  cctx.clearRect(
    Math.round(s.x),
    Math.round(s.y),
    Math.round(s.width),
    Math.round(s.height)
  );

  return c.toDataURL("image/png");
}

function createPngDataUrlFromActiveImage() {
  const image = state.activeImageElement;
  const c = document.createElement("canvas");
  c.width = image.naturalWidth;
  c.height = image.naturalHeight;
  const cctx = c.getContext("2d");
  cctx.drawImage(image, 0, 0);
  return c.toDataURL("image/png");
}

async function useResultAsBase() {
  if (!state.outputDataUrl) return;

  const img = await dataUrlToImage(state.outputDataUrl);
  const item = {
    id: crypto.randomUUID(),
    name: `edited-${Date.now()}.png`,
    dataUrl: state.outputDataUrl,
    width: img.naturalWidth,
    height: img.naturalHeight
  };

  state.images.unshift(item);
  renderImageList();
  await setActiveImage(item.id);
  saveTempSession();
  setStatus("Result promoted to new base image.");
}

function downloadResult() {
  const items = state.outputItems.length
    ? state.outputItems
    : state.outputDataUrl
      ? [{ title: "floorplan-edit", dataUrl: state.outputDataUrl }]
      : [];

  if (!items.length) return;

  for (const [index, item] of items.entries()) {
    const a = document.createElement("a");
    a.href = item.dataUrl;
    a.download = `${slugify(item.title)}-${Date.now()}-${index + 1}.png`;
    a.click();
  }
}

function scheduleTempSave() {
  window.clearTimeout(tempSaveTimer);
  tempSaveTimer = window.setTimeout(saveTempSession, 600);
}

async function saveTempSession() {
  if (!("indexedDB" in window)) return;

  const activeImage = state.images.find((item) => item.id === state.activeImageId) || null;
  if (!activeImage && !state.outputItems.length) return;

  try {
    const db = await openTempDb();
    await idbPut(db, {
      id: TEMP_SESSION_KEY,
      timestamp: Date.now(),
      prompt: promptInput.value,
      style: styleInput.value,
      activeImage,
      outputDataUrl: state.outputDataUrl,
      outputItems: state.outputItems
    });
    db.close();
  } catch {
    // Temporary storage is best-effort only.
  }
}

async function restoreTempSession() {
  if (!("indexedDB" in window)) return;

  try {
    const db = await openTempDb();
    const session = await idbGet(db, TEMP_SESSION_KEY);

    if (!session) {
      db.close();
      return;
    }

    if (Date.now() - Number(session.timestamp || 0) > TEMP_TTL_MS) {
      await idbDelete(db, TEMP_SESSION_KEY);
      db.close();
      return;
    }

    promptInput.value = session.prompt?.trim() || DEFAULT_USER_PROMPT;
    if (session.style) styleInput.value = session.style;

    if (session.activeImage?.dataUrl) {
      state.images = [session.activeImage];
      renderImageList();
      await setActiveImage(session.activeImage.id, { skipSave: true });
    }

    state.outputDataUrl = session.outputDataUrl || null;
    state.outputItems = Array.isArray(session.outputItems) ? session.outputItems : [];
    if (state.outputDataUrl) {
      resultPreview.src = state.outputDataUrl;
      useResultBtn.disabled = false;
      downloadBtn.disabled = false;
    }
    renderResultGallery(state.outputItems);
    updatePromptPreview();
    setStatus("Restored temporary session from this browser.");
    db.close();
  } catch {
    // Ignore temporary storage failures; generation still works normally.
  }
}

function openTempDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TEMP_DB_NAME, TEMP_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TEMP_STORE_NAME)) {
        db.createObjectStore(TEMP_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(db, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEMP_STORE_NAME, "readwrite");
    tx.objectStore(TEMP_STORE_NAME).put(value);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEMP_STORE_NAME, "readonly");
    const request = tx.objectStore(TEMP_STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbDelete(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEMP_STORE_NAME, "readwrite");
    tx.objectStore(TEMP_STORE_NAME).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function getCanvasPoint(event) {
  const rect = editorCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function canvasToImagePoint(canvasX, canvasY) {
  const fit = state.viewRect;
  const image = state.activeImageElement;

  const clampedX = clamp(canvasX, fit.x, fit.x + fit.width);
  const clampedY = clamp(canvasY, fit.y, fit.y + fit.height);

  return {
    x: ((clampedX - fit.x) / fit.width) * image.naturalWidth,
    y: ((clampedY - fit.y) / fit.height) * image.naturalHeight
  };
}

function normalizeSelection(x1, y1, x2, y2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  return { x, y, width, height };
}

function fitRect(sourceW, sourceH, maxW, maxH, padding = 0) {
  const widthLimit = maxW - padding * 2;
  const heightLimit = maxH - padding * 2;
  const scale = Math.min(widthLimit / sourceW, heightLimit / sourceH);
  const width = sourceW * scale;
  const height = sourceH * scale;

  return {
    x: (maxW - width) / 2,
    y: (maxH - height) / 2,
    width,
    height
  };
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function trimName(name, maxChars) {
  if (name.length <= maxChars) return name;
  return `${name.slice(0, maxChars - 1)}…`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "image";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

clearCanvas();
updatePromptPreview();
setStatus("Upload a floorplan image to begin.");
restoreTempSession();
