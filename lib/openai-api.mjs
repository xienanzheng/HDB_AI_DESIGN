export const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const MAX_JSON_BODY_BYTES = 25 * 1024 * 1024;

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
    model = DEFAULT_IMAGE_MODEL,
    quality = "high",
    size = "auto",
    action = "edit"
  } = body || {};

  if (!imageDataUrl || !maskDataUrl || !prompt) {
    return {
      status: 400,
      body: { error: "imageDataUrl, maskDataUrl, and prompt are required" }
    };
  }

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: String(prompt) },
              { type: "input_image", image_url: imageDataUrl, detail: "high" }
            ]
          }
        ],
        tools: [buildImageTool({ model, action, quality, size, maskDataUrl })],
        tool_choice: { type: "image_generation" }
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
        error: payload?.error?.message || "OpenAI image edit request failed",
        requestId
      }
    };
  }

  try {
    const imageCall = parseImageGenerationCall(payload);
    return {
      status: 200,
      body: {
        editedImageDataUrl: `data:image/png;base64,${imageCall.result}`,
        revisedPrompt: imageCall.revised_prompt || null,
        requestId
      }
    };
  } catch {
    return {
      status: 500,
      body: {
        error: "OpenAI response did not include an image_generation result",
        requestId
      }
    };
  }
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
    model = "gpt-4.1-mini",
    imageModel = DEFAULT_IMAGE_MODEL,
    quality = "high",
    size = "auto"
  } = body || {};

  if (!prompt) {
    return { status: 400, body: { error: "prompt is required" } };
  }

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
        input: String(prompt),
        tools: [buildImageTool({ model: imageModel, action: "generate", quality, size })],
        tool_choice: { type: "image_generation" }
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
        error: payload?.error?.message || "OpenAI image generation request failed",
        requestId
      }
    };
  }

  try {
    const imageCall = parseImageGenerationCall(payload);
    return {
      status: 200,
      body: {
        generatedImageDataUrl: `data:image/png;base64,${imageCall.result}`,
        revisedPrompt: imageCall.revised_prompt || null,
        requestId
      }
    };
  } catch {
    return {
      status: 500,
      body: {
        error: "Responses API did not include an image_generation result",
        requestId
      }
    };
  }
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

function buildImageTool({ model, action, quality, size, maskDataUrl }) {
  const tool = {
    type: "image_generation",
    model,
    quality,
    size
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
