import { getConfiguredImageModel, sendJson } from "../lib/openai-api.mjs";

export default function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  return sendJson(res, 200, { ok: true, imageModel: getConfiguredImageModel() });
}
