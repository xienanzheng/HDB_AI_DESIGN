export const DEFAULT_IMAGE_MODEL = "gpt-image-1.5";
const FALLBACK_IMAGE_MODEL = "gpt-image-1";
const MAX_JSON_BODY_BYTES = 25 * 1024 * 1024;
const DEFAULT_IMAGE_SIZE = "1024x1024";
const SUPPORTED_IMAGE_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const IMAGE_MODEL_ALIASES = new Map([
  ["gpt-image-2", "gpt-image-1.5"],
  ["gpt-image-2.0", "gpt-image-1.5"]
]);

export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    return parseJson(req.body);
  }

  return new Promise((resolve, reject) => {
    let raw = "";
    let total = 0;

    req.setEncoding?.("utf8");

    req.on("data", (chunk) => {
      total += Buffer.byteLength(chunk);
      if (total > MAX_JSON_BODY_BYTES) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      raw += chunk;
    });

    req.on("end", () => resolve(parseJson(raw || "{}")));
    req.on("error", reject);
  });
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export async function imageEdit(body, apiKey = process.env.OPENAI_API_KEY) {
  if (!apiKey) {
    return {
      status: 500,
      body: { error: "OPENAI_API_KEY is missing. Add it to your environment variables." }
    };
  }

  const {
    imageDataUrl,
    maskDataUrl,
    prompt,
    model = body?.imageModel || getDefaultImageModel(),
    quality = "high",
    size = DEFAULT_IMAGE_SIZE
  } = body || {};
  const resolvedModel = normalizeImageModel(model) || getDefaultImageModel();

  if (!imageDataUrl || !maskDataUrl || !prompt) {
    return {
      status: 400,
      body: { error: "imageDataUrl, maskDataUrl, and prompt are required" }
    };
  }

  return callImageEditApi({
    apiKey,
    imageDataUrl,
    maskDataUrl,
    prompt,
    model: resolvedModel,
    quality,
    size,
    responseKey: "editedImageDataUrl"
  });
}

export async function imageGenerate(body, apiKey = process.env.OPENAI_API_KEY) {
  if (!apiKey) {
    return {
      status: 500,
      body: { error: "OPENAI_API_KEY is missing. Add it to your environment variables." }
    };
  }

  const {
    prompt,
    imageDataUrl,
    model = "gpt-4.1-mini",
    imageModel = getDefaultImageModel(),
    quality = "high",
    size = DEFAULT_IMAGE_SIZE
  } = body || {};
  const resolvedImageModel = normalizeImageModel(imageModel) || getDefaultImageModel();

  if (!prompt) {
    return { status: 400, body: { error: "prompt is required" } };
  }

  if (imageDataUrl) {
    return callImageEditApi({
      apiKey,
      imageDataUrl,
      prompt,
      model: resolvedImageModel,
      quality,
      size,
      responseKey: "generatedImageDataUrl"
    });
  }

  return callImageGenerationApi({
    apiKey,
    prompt,
    model: resolvedImageModel,
    quality,
    size
  });
}

export async function interiorDesignerAssist(body, apiKey = process.env.OPENAI_API_KEY) {
  if (!apiKey) {
    return {
      status: 500,
      body: { error: "OPENAI_API_KEY is missing. Add it to your environment variables." }
    };
  }

  const {
    imageDataUrl,
    selection,
    roomType = "General area",
    style = "Japandi",
    mood = "Warm and calm",
    budgetTier = "Mid",
    mustKeep = "",
    mustHave = "",
    avoid = "",
    household = "",
    model = "gpt-4.1"
  } = body || {};

  if (!imageDataUrl) {
    return { status: 400, body: { error: "imageDataUrl is required" } };
  }

  const selectionNote = selection
    ? `Selected area (pixels): x=${Math.round(selection.x)}, y=${Math.round(selection.y)}, width=${Math.round(selection.width)}, height=${Math.round(selection.height)}`
    : "No explicit selection provided. Analyze the full image.";

  const brief = [
    `Room type: ${roomType}`,
    `Style direction: ${style}`,
    `Mood: ${mood}`,
    `Budget tier: ${budgetTier}`,
    `Household profile: ${household || "not specified"}`,
    `Must keep: ${mustKeep || "none specified"}`,
    `Must have: ${mustHave || "none specified"}`,
    `Avoid: ${avoid || "none specified"}`,
    selectionNote
  ].join("\n");

  const structuralRules = [
    "Structural columns must not be hacked, removed, resized, shifted, hidden, or reinterpreted.",
    "Do not alter load-bearing walls, beams, household shelter walls, shafts, windows, exterior facade edges, plumbing stacks, or AC ledge boundaries.",
    "Only propose changes to loose furniture, built-ins, finishes, lighting, non-structural partitions, storage, and styling."
  ].join(" ");

  const instruction = `You are an experienced interior designer reviewing a floorplan or interior image.\nUse the visual context and client brief below.\n${brief}\n\nNon-negotiable structural rules:\n${structuralRules}\n\nReturn response in this exact plain-text format:\nOBSERVATIONS:\n- ...\nCONSTRAINTS:\n- ...\nOPPORTUNITIES:\n- ...\nMATERIALS:\n- ...\nLIGHTING:\n- ...\nFURNITURE_LAYOUT:\n- ...\nEDIT_PROMPT:\n<single paragraph prompt for GPT Image that preserves fixed structural elements while redesigning only the requested area>`;

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: instruction },
              { type: "input_image", image_url: imageDataUrl, detail: "high" }
            ]
          }
        ]
      })
    });
  } catch {
    return { status: 502, body: { error: "Failed to reach OpenAI API" } };
  }

  const requestId = response.headers.get("x-request-id") || undefined;
  const payload = await safeReadJson(response);

  if (!response.ok) {
    return {
      status: response.status,
      body: {
        error: payload?.error?.message || "OpenAI vision analysis request failed",
        requestId
      }
    };
  }

  const analysisText = extractResponseText(payload).trim();
  return {
    status: 200,
    body: {
      analysisText,
      suggestedPrompt: extractEditPrompt(analysisText),
      requestId
    }
  };
}

function normalizeImageSize(size) {
  return SUPPORTED_IMAGE_SIZES.has(size) ? size : DEFAULT_IMAGE_SIZE;
}

function getDefaultImageModel() {
  return normalizeImageModel(process.env.OPENAI_IMAGE_MODEL) || DEFAULT_IMAGE_MODEL;
}

export function getConfiguredImageModel() {
  return getDefaultImageModel();
}

function normalizeImageModel(model) {
  const value = String(model || "").trim().toLowerCase();
  if (!value) return "";
  return IMAGE_MODEL_ALIASES.get(value) || value;
}

function dataUrlToFile(dataUrl, filename) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!match) {
    throw new Error("Image data must be a base64 data URL");
  }

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  return {
    blob: new Blob([buffer], { type: mimeType }),
    filename
  };
}

async function callImageEditApi({
  apiKey,
  imageDataUrl,
  maskDataUrl,
  prompt,
  model,
  quality,
  size,
  responseKey,
  attemptedModel
}) {
  const resolvedModel = normalizeImageModel(model) || getDefaultImageModel();
  let imageFile;
  let maskFile;
  try {
    imageFile = dataUrlToFile(imageDataUrl, "source.png");
    maskFile = maskDataUrl ? dataUrlToFile(maskDataUrl, "mask.png") : null;
  } catch (error) {
    return { status: 400, body: { error: error.message || "Invalid image data URL" } };
  }

  const formData = new FormData();
  formData.append("model", resolvedModel);
  formData.append("prompt", String(prompt));
  formData.append("quality", quality || "medium");
  formData.append("size", normalizeImageSize(size));
  formData.append("input_fidelity", "high");
  formData.append("image", imageFile.blob, imageFile.filename);
  if (maskFile) {
    formData.append("mask", maskFile.blob, maskFile.filename);
  }

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData
    });
  } catch {
    return { status: 502, body: { error: "Failed to reach OpenAI API" } };
  }

  const requestId = response.headers.get("x-request-id") || undefined;
  const payload = await safeReadJson(response);

  if (!response.ok) {
    if (shouldRetryImageModel(resolvedModel, payload)) {
      return callImageEditApi({
        apiKey,
        imageDataUrl,
        maskDataUrl,
        prompt,
        model: FALLBACK_IMAGE_MODEL,
        quality,
        size,
        responseKey,
        attemptedModel: attemptedModel || resolvedModel
      });
    }

    return {
      status: response.status,
      body: {
        error: payload?.error?.message || "OpenAI image edit request failed",
        requestId,
        model: resolvedModel
      }
    };
  }

  try {
    return {
      status: 200,
      body: {
        [responseKey]: parseImagesApiResult(payload),
        revisedPrompt: null,
        requestId,
        model: resolvedModel,
        attemptedModel: attemptedModel || null
      }
    };
  } catch {
    return {
      status: 500,
      body: {
        error: "OpenAI response did not include an image result",
        requestId,
        model: resolvedModel
      }
    };
  }
}

async function callImageGenerationApi({ apiKey, prompt, model, quality, size, attemptedModel }) {
  const resolvedModel = normalizeImageModel(model) || getDefaultImageModel();
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: resolvedModel,
        prompt: String(prompt),
        quality: quality || "medium",
        size: normalizeImageSize(size)
      })
    });
  } catch {
    return { status: 502, body: { error: "Failed to reach OpenAI API" } };
  }

  const requestId = response.headers.get("x-request-id") || undefined;
  const payload = await safeReadJson(response);

  if (!response.ok) {
    if (shouldRetryImageModel(resolvedModel, payload)) {
      return callImageGenerationApi({
        apiKey,
        prompt,
        model: FALLBACK_IMAGE_MODEL,
        quality,
        size,
        attemptedModel: attemptedModel || resolvedModel
      });
    }

    return {
      status: response.status,
      body: {
        error: payload?.error?.message || "OpenAI image generation request failed",
        requestId,
        model: resolvedModel
      }
    };
  }

  try {
    return {
      status: 200,
      body: {
        generatedImageDataUrl: parseImagesApiResult(payload),
        revisedPrompt: null,
        requestId,
        model: resolvedModel,
        attemptedModel: attemptedModel || null
      }
    };
  } catch {
    return {
      status: 500,
      body: {
        error: "OpenAI response did not include an image result",
        requestId,
        model: resolvedModel
      }
    };
  }
}

function shouldRetryImageModel(model, payload) {
  if (!model || model === FALLBACK_IMAGE_MODEL) return false;
  const message = String(payload?.error?.message || "").toLowerCase();
  const code = String(payload?.error?.code || "").toLowerCase();
  const param = String(payload?.error?.param || "").toLowerCase();
  return (
    message.includes("pattern") ||
    message.includes("model") ||
    message.includes("unsupported") ||
    message.includes("not found") ||
    code.includes("model") ||
    param === "model"
  );
}

function parseImagesApiResult(payload) {
  const image = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (typeof image?.b64_json === "string") {
    return `data:image/png;base64,${image.b64_json}`;
  }
  if (typeof image?.url === "string") {
    return image.url;
  }
  throw new Error("No image data returned");
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  if (Array.isArray(payload?.output_text) && payload.output_text.length) {
    return payload.output_text.map((entry) => entry?.text || entry).join("\n");
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = [];
  for (const item of outputs) {
    if (item?.type === "message" && Array.isArray(item?.content)) {
      for (const contentItem of item.content) {
        if (contentItem?.type === "output_text" && typeof contentItem?.text === "string") {
          chunks.push(contentItem.text);
        }
      }
    }
    if (item?.type === "output_text" && typeof item?.text === "string") {
      chunks.push(item.text);
    }
  }
  return chunks.join("\n");
}

function extractEditPrompt(analysisText) {
  const marker = "EDIT_PROMPT:";
  const markerIndex = analysisText.indexOf(marker);
  if (markerIndex === -1) return "";
  return analysisText.slice(markerIndex + marker.length).trim();
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseJson(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}
