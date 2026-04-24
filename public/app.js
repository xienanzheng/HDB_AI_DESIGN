const fileInput = document.getElementById("fileInput");
const uploadDrop = document.getElementById("uploadDrop");
const imageList = document.getElementById("imageList");
const editorCanvas = document.getElementById("editorCanvas");
const selectionMeta = document.getElementById("selectionMeta");
const promptInput = document.getElementById("promptInput");
const generationTypeSelect = document.getElementById("generationTypeSelect");
const angleCountSelect = document.getElementById("angleCountSelect");
const roomTypeInput = document.getElementById("roomTypeInput");
const styleInput = document.getElementById("styleInput");
const moodInput = document.getElementById("moodInput");
const budgetInput = document.getElementById("budgetInput");
const householdInput = document.getElementById("householdInput");
const visionModelSelect = document.getElementById("visionModelSelect");
const mustKeepInput = document.getElementById("mustKeepInput");
const mustHaveInput = document.getElementById("mustHaveInput");
const avoidInput = document.getElementById("avoidInput");
const modelSelect = document.getElementById("modelSelect");
const actionSelect = document.getElementById("actionSelect");
const qualitySelect = document.getElementById("qualitySelect");
const sizeSelect = document.getElementById("sizeSelect");
const responsesModelSelect = document.getElementById("responsesModelSelect");
const runAnalyzeBtn = document.getElementById("runAnalyzeBtn");
const applySuggestionBtn = document.getElementById("applySuggestionBtn");
const runEditBtn = document.getElementById("runEditBtn");
const runGenerateBtn = document.getElementById("runGenerateBtn");
const useResultBtn = document.getElementById("useResultBtn");
const downloadBtn = document.getElementById("downloadBtn");
const analysisOutput = document.getElementById("analysisOutput");
const statusText = document.getElementById("statusText");
const basePreview = document.getElementById("basePreview");
const resultPreview = document.getElementById("resultPreview");
const resultGallery = document.getElementById("resultGallery");

const ctx = editorCanvas.getContext("2d");

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
  suggestedPrompt: "",
  busy: false
};

fileInput.addEventListener("change", handleFileInput);
uploadDrop.addEventListener("dragover", (event) => {
  event.preventDefault();
});
uploadDrop.addEventListener("drop", handleFileDrop);
window.addEventListener("resize", renderCanvas);
editorCanvas.addEventListener("mousedown", handleMouseDown);
window.addEventListener("mousemove", handleMouseMove);
window.addEventListener("mouseup", handleMouseUp);
runAnalyzeBtn.addEventListener("click", runInteriorDesignerAssist);
applySuggestionBtn.addEventListener("click", applySuggestedPrompt);
runEditBtn.addEventListener("click", runImageEdit);
runGenerateBtn.addEventListener("click", runPromptGeneration);
useResultBtn.addEventListener("click", useResultAsBase);
downloadBtn.addEventListener("click", downloadResult);

function setStatus(text) {
  statusText.textContent = text;
}

function setBusy(busy) {
  state.busy = busy;
  runAnalyzeBtn.disabled = busy;
  applySuggestionBtn.disabled = busy || !state.suggestedPrompt;
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
    setActiveImage(state.images[0].id);
  }

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

async function setActiveImage(imageId) {
  const item = state.images.find((x) => x.id === imageId);
  if (!item) return;

  state.activeImageId = imageId;
  state.activeImageDataUrl = item.dataUrl;
  state.activeImageElement = await dataUrlToImage(item.dataUrl);
  state.selection = null;
  state.outputDataUrl = null;
  state.outputItems = [];
  state.suggestedPrompt = "";

  resultPreview.removeAttribute("src");
  renderResultGallery([]);
  useResultBtn.disabled = true;
  downloadBtn.disabled = true;
  applySuggestionBtn.disabled = true;
  analysisOutput.textContent = "No AI analysis yet.";

  basePreview.src = item.dataUrl;
  selectionMeta.textContent = "No selection yet.";

  renderImageList();
  renderCanvas();
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

function handleMouseDown(event) {
  if (!state.activeImageElement || !state.viewRect) return;

  const p = getCanvasPoint(event);
  if (!pointInRect(p.x, p.y, state.viewRect)) return;

  state.dragStart = canvasToImagePoint(p.x, p.y);
  state.selection = {
    x: state.dragStart.x,
    y: state.dragStart.y,
    width: 1,
    height: 1
  };

  renderCanvas();
}

function handleMouseMove(event) {
  if (!state.dragStart || !state.activeImageElement) return;

  const p = getCanvasPoint(event);
  const end = canvasToImagePoint(p.x, p.y);

  state.selection = normalizeSelection(state.dragStart.x, state.dragStart.y, end.x, end.y);
  updateSelectionMeta();
  renderCanvas();
}

function handleMouseUp() {
  if (!state.dragStart) return;

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
    const prompt = buildDesignerPrompt(rawPrompt, {
      generationType: generationTypeSelect.value,
      angleLabel: "primary design view",
      useSelection: true
    });

    const payload = {
      imageDataUrl: state.activeImageDataUrl,
      maskDataUrl,
      prompt,
      model: modelSelect.value,
      action: actionSelect.value,
      quality: qualitySelect.value,
      size: sizeSelect.value
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
        title: getGenerationTitle(generationTypeSelect.value, 1),
        dataUrl: data.editedImageDataUrl
      }
    ];
    resultPreview.src = state.outputDataUrl;
    renderResultGallery(state.outputItems);
    useResultBtn.disabled = false;
    downloadBtn.disabled = false;

    if (data.revisedPrompt) {
      analysisOutput.textContent = `Revised image prompt used by model:\n${data.revisedPrompt}`;
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

  const rawPrompt = promptInput.value.trim();
  if (!rawPrompt) {
    setStatus("Write a prompt first.");
    return;
  }

  setBusy(true);
  setStatus("Generating image via Responses API...");

  try {
    const prompts = buildGenerationPrompts(rawPrompt);
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
          prompt: item.prompt,
          model: responsesModelSelect.value,
          imageModel: modelSelect.value,
          quality: qualitySelect.value,
          size: sizeSelect.value
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
    if (revisedPrompts.length) {
      analysisOutput.textContent = `Revised image prompt used by model:\n${revisedPrompts.join("\n\n")}`;
    }

    setStatus(
      outputs.length > 1
        ? `${outputs.length} images generated.`
        : "Image generated (Responses API)."
    );
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function runInteriorDesignerAssist() {
  if (state.busy) return;

  if (!state.activeImageDataUrl) {
    setStatus("Upload and select an image first.");
    return;
  }

  setBusy(true);
  setStatus("Analyzing image with GPT Vision for interior design recommendations...");

  try {
    const response = await fetch("/api/id-assist", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        imageDataUrl: state.activeImageDataUrl,
        selection: state.selection,
        roomType: roomTypeInput.value,
        style: styleInput.value,
        mood: moodInput.value,
        budgetTier: budgetInput.value,
        household: householdInput.value,
        mustKeep: mustKeepInput.value,
        mustHave: mustHaveInput.value,
        avoid: avoidInput.value,
        model: visionModelSelect.value
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Vision analysis failed");
    }

    analysisOutput.textContent = data.analysisText || "No analysis content returned.";
    state.suggestedPrompt = (data.suggestedPrompt || "").trim();
    applySuggestionBtn.disabled = !state.suggestedPrompt;

    setStatus(
      data.requestId
        ? `Interior design analysis completed. Request ID: ${data.requestId}`
        : "Interior design analysis completed."
    );
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function applySuggestedPrompt() {
  if (!state.suggestedPrompt) return;
  promptInput.value = state.suggestedPrompt;
  setStatus("Suggested prompt applied. Review and run Generate Edit.");
}

function buildGenerationPrompts(rawPrompt) {
  const type = generationTypeSelect.value;
  if (type !== "angles") {
    return [
      {
        title: getGenerationTitle(type, 1),
        prompt: buildDesignerPrompt(rawPrompt, {
          generationType: type,
          angleLabel: type === "layout" ? "top-down plan view" : "hero 3D interior render"
        })
      }
    ];
  }

  const count = Number(angleCountSelect.value || 3);
  const angleLabels = [
    "wide-angle living and dining perspective",
    "kitchen and storage perspective",
    "bedroom or private-zone perspective",
    "entry foyer and circulation perspective",
    "detail view of built-ins, materials, and lighting"
  ];

  return angleLabels.slice(0, count).map((angleLabel, index) => ({
    title: getGenerationTitle(type, index + 1, angleLabel),
    prompt: buildDesignerPrompt(rawPrompt, {
      generationType: "angles",
      angleLabel
    })
  }));
}

function buildDesignerPrompt(rawPrompt, options = {}) {
  const generationType = options.generationType || generationTypeSelect.value;
  const modeText = getModePrompt(generationType, options.angleLabel);
  const fixedConstraints = [
    "Do not remove, hack, resize, shift, cover, or reinterpret structural columns.",
    "Do not modify load-bearing walls, beams, shafts, windows, exterior facade edges, plumbing stacks, household shelter walls, or AC ledge boundaries.",
    "Only reimagine non-structural partitions, loose furniture, built-ins, finishes, lighting, styling, and storage systems.",
    "Keep circulation clear and practical; maintain door swings and safe access paths."
  ].join(" ");

  const clientBrief = [
    `Room type: ${roomTypeInput.value}.`,
    `Style: ${styleInput.value}.`,
    `Mood: ${moodInput.value || "not specified"}.`,
    `Budget: ${budgetInput.value}.`,
    householdInput.value ? `Household: ${householdInput.value}.` : "",
    mustKeepInput.value ? `User must keep: ${mustKeepInput.value}.` : "",
    mustHaveInput.value ? `User must have: ${mustHaveInput.value}.` : "",
    avoidInput.value ? `Avoid: ${avoidInput.value}.` : ""
  ]
    .filter(Boolean)
    .join(" ");

  const selectionText = options.useSelection
    ? "Apply the change only inside the selected masked area; use surrounding image context for alignment."
    : "Use the uploaded plan or prompt context as the design basis.";

  return [
    modeText,
    fixedConstraints,
    clientBrief,
    selectionText,
    `Designer instruction: ${rawPrompt}`
  ].join("\n\n");
}

function getModePrompt(type, angleLabel = "") {
  if (type === "layout") {
    return "Create a detailed top-down interior layout visualization. Reimagine furniture placement, ergonomic clearances, storage, and non-structural partitions while preserving all fixed structural elements. Use clear plan readability, furniture labels where useful, and realistic proportions.";
  }

  if (type === "render") {
    return "Create a polished 3D interior rendering image from the design concept. Show materials, lighting, furniture, built-ins, soft styling, and spatial atmosphere. Keep the design feasible according to the original floorplan.";
  }

  return `Create one 3D interior rendering from this camera/view: ${angleLabel}. The render must match the same design language and material palette as the main design concept.`;
}

function getGenerationTitle(type, index, angleLabel = "") {
  if (type === "layout") return "Top-down layout";
  if (type === "render") return "3D rendering";
  return `Perspective ${index}${angleLabel ? ` - ${angleLabel}` : ""}`;
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
setStatus("Upload a floorplan image to begin.");
