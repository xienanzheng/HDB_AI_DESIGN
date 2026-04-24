import { interiorDesignerAssist, readJsonBody, sendJson } from "../lib/openai-api.mjs";

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = await readJsonBody(req);
    const result = await interiorDesignerAssist(body);
    return sendJson(res, result.status, result.body);
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Invalid request" });
  }
}
