import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_PORT = 3000;
const MAX_JSON_BODY_BYTES = 25 * 1024 * 1024;
const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_SIZE = "1024x1024";
const SUPPORTED_IMAGE_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const FALLBACK_IMAGE_MODEL = "gpt-image-1.5";

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || DEFAULT_PORT);
const HOST = process.env.HOST || "127.0.0.1";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/api/edit") {
      return await handleImageEdit(req, res);
    }

    if (req.method === "POST" && req.url === "/api/generate") {
      return await handleImageGenerate(req, res);
    }

    if (req.method === "POST" && req.url === "/api/id-assist") {
      return await handleInteriorDesignerAssist(req, res);
    }

    if (req.method === "GET") {
      return await serveStatic(req, res);
    }

    return sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("Unhandled server error:", error);
    return sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Floorplan AI Editor running at http://${HOST}:${PORT}`);
});

async function handleImageEdit(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, {
      error: "OPENAI_API_KEY is missing. Add it to your .env file."
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Invalid JSON body" });
  }

  return handleImageEditWithBody(res, body, apiKey);
}

async function handleImageEditWithBody(res, body, apiKey) {
  const {
    imageDataUrl,
    maskDataUrl,
    prompt,
    model = DEFAULT_IMAGE_MODEL,
    quality = "high",
    size = DEFAULT_IMAGE_SIZE
  } = body || {};

  if (!imageDataUrl || !maskDataUrl || !prompt) {
    return sendJson(res, 400, {
      error: "imageDataUrl, maskDataUrl, and prompt are required"
    });
  }

  let imageFile;
  let maskFile;
  try {
    imageFile = dataUrlToFile(imageDataUrl, "image.png");
    maskFile = dataUrlToFile(maskDataUrl, "mask.png");
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Invalid image data URL" });
  }

  const formData = new FormData();
  formData.append("model", model);
  formData.append("prompt", String(prompt));
  formData.append("quality", quality);
  formData.append("size", normalizeImageSize(size));
  formData.append("image[]", imageFile.blob, imageFile.filename);
  formData.append("mask", maskFile.blob, maskFile.filename);

  let openaiRes;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData
    });
  } catch {
    return sendJson(res, 502, { error: "Failed to reach OpenAI API" });
  }

  const requestId = openaiRes.headers.get("x-request-id") || undefined;
  const payload = await safeReadJson(openaiRes);

  if (!openaiRes.ok) {
    if (shouldRetryWithFallbackImageModel(model, payload)) {
      return handleImageEditWithBody(res, { ...body, model: FALLBACK_IMAGE_MODEL }, apiKey);
    }

    const detail = payload?.error?.message || "OpenAI image edit request failed";
    return sendJson(res, openaiRes.status, {
      error: detail,
      requestId
    });
  }

  try {
    const imageData = parseImagesApiResult(payload);
    return sendJson(res, 200, {
      editedImageDataUrl: imageData,
      revisedPrompt: null,
      requestId
    });
  } catch {
    return sendJson(res, 500, {
      error: "OpenAI response did not include an edited image result",
      requestId
    });
  }
}

async function handleImageGenerate(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, {
      error: "OPENAI_API_KEY is missing. Add it to your .env file."
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Invalid JSON body" });
  }

  return handleImageGenerateWithBody(res, body, apiKey);
}

async function handleImageGenerateWithBody(res, body, apiKey) {
  const {
    prompt,
    imageDataUrl,
    model = "gpt-4.1-mini",
    imageModel = DEFAULT_IMAGE_MODEL,
    quality = "high",
    size = DEFAULT_IMAGE_SIZE
  } = body || {};
  if (!prompt) {
    return sendJson(res, 400, { error: "prompt is required" });
  }

  let openaiRes;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: imageDataUrl
          ? [
              {
                role: "user",
                content: [
                  { type: "input_text", text: String(prompt) },
                  { type: "input_image", image_url: imageDataUrl, detail: "high" }
                ]
              }
            ]
          : String(prompt),
        tools: [buildImageTool({ model: imageModel, action: "generate", quality, size })],
        tool_choice: { type: "image_generation" }
      })
    });
  } catch {
    return sendJson(res, 502, { error: "Failed to reach OpenAI API" });
  }

  const requestId = openaiRes.headers.get("x-request-id") || undefined;
  const payload = await safeReadJson(openaiRes);
  if (!openaiRes.ok) {
    if (shouldRetryWithFallbackImageModel(imageModel, payload)) {
      return handleImageGenerateWithBody(res, { ...body, imageModel: FALLBACK_IMAGE_MODEL }, apiKey);
    }

    const detail = payload?.error?.message || "OpenAI image generation request failed";
    return sendJson(res, openaiRes.status, { error: detail, requestId });
  }

  try {
    const imageCall = parseImageGenerationCall(payload);
    return sendJson(res, 200, {
      generatedImageDataUrl: `data:image/png;base64,${imageCall.result}`,
      revisedPrompt: imageCall.revised_prompt || null,
      requestId
    });
  } catch {
    return sendJson(res, 500, {
      error: "Responses API did not include an image_generation result",
      requestId
    });
  }
}

async function handleInteriorDesignerAssist(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, {
      error: "OPENAI_API_KEY is missing. Add it to your .env file."
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Invalid JSON body" });
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
    return sendJson(res, 400, { error: "imageDataUrl is required" });
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

  let openaiRes;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/responses", {
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
    return sendJson(res, 502, { error: "Failed to reach OpenAI API" });
  }

  const requestId = openaiRes.headers.get("x-request-id") || undefined;
  const payload = await safeReadJson(openaiRes);
  if (!openaiRes.ok) {
    const detail = payload?.error?.message || "OpenAI vision analysis request failed";
    return sendJson(res, openaiRes.status, { error: detail, requestId });
  }

  const analysisText = extractResponseText(payload).trim();
  const suggestedPrompt = extractEditPrompt(analysisText);
  return sendJson(res, 200, {
    analysisText,
    suggestedPrompt,
    requestId
  });
}

function parseImageGenerationCall(payload) {
  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  const imageCall = outputs.find(
    (item) =>
      item?.type === "image_generation_call" &&
      item?.status !== "failed" &&
      typeof item?.result === "string"
  );
  if (!imageCall) {
    throw new Error("No image_generation_call result");
  }

  return imageCall;
}

function buildImageTool({ model, action, quality, size, maskDataUrl }) {
  const tool = {
    type: "image_generation",
    model,
    quality,
    size: normalizeImageSize(size)
  };

  if ((model === "gpt-image-1.5" || model === "chatgpt-image-latest") && action) {
    tool.action = action;
  }

  if (maskDataUrl) {
    tool.input_image_mask = {
      image_url: maskDataUrl
    };
  }

  return tool;
}

function normalizeImageSize(size) {
  return SUPPORTED_IMAGE_SIZES.has(size) ? size : DEFAULT_IMAGE_SIZE;
}

function shouldRetryWithFallbackImageModel(model, payload) {
  if (!model || model === FALLBACK_IMAGE_MODEL) return false;
  const message = String(payload?.error?.message || "").toLowerCase();
  return (
    message.includes("pattern") ||
    message.includes("model") ||
    message.includes("unsupported") ||
    message.includes("not found")
  );
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

async function serveStatic(req, res) {
  let pathname = req.url || "/";
  if (pathname === "/") pathname = "/index.html";

  const normalizedPath = path.normalize(pathname).replace(/^\/+/, "");
  const targetPath = path.join(PUBLIC_DIR, normalizedPath);

  if (!targetPath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  try {
    const file = await readFile(targetPath);
    const ext = path.extname(targetPath).toLowerCase();
    const type = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
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

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let total = 0;

    req.setEncoding("utf8");

    req.on("data", (chunk) => {
      total += Buffer.byteLength(chunk);
      if (total > MAX_JSON_BODY_BYTES) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      raw += chunk;
    });

    req.on("end", () => {
      try {
        const json = JSON.parse(raw || "{}");
        resolve(json);
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });

    req.on("error", (err) => reject(err));
  });
}

function loadEnv(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env is optional; environment variables can be set by shell.
  }
}
