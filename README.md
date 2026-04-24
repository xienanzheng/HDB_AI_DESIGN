# Floorplan AI Edit Tool

A private interior-design copilot for floorplan/image edits using GPT Image + GPT Vision.

## What it does

- Upload one or more plan images.
- Click an image to make it active.
- Drag a rectangular region on the canvas to mark the exact area to replace.
- Use the **Interior Designer brief** fields (room type, style, mood, budget, must-keep, must-have, avoid).
- Run **Analyze as ID (Vision)** to get plan-specific observations, constraints, and a suggested edit prompt.
- Generate detailed top-down layouts that rework furniture and non-structural partitions.
- Generate 3D design renderings for styles such as Japandi, Scandinavian, Modern Minimalist, and Wabi-Sabi.
- Generate a multi-angle set of perspective renders from the same design concept.
- Preserve structural columns, load-bearing walls, beams, shafts, windows, plumbing stacks, and AC ledge boundaries in every prompt.
- Generate edits with Responses API `image_generation` + mask (default model: `gpt-image-2`).
- Promote an output image as the new base image and continue iterating.

## Setup

1. Create a `.env` file in the project root.
2. Add:

```bash
OPENAI_API_KEY=sk-...
PORT=3000
HOST=127.0.0.1
```

3. Start the app:

```bash
npm run dev
```

4. Open `http://localhost:3000`.

## Deploy on Vercel

This repo can be deployed as a static site plus Vercel Functions:

```bash
npm install -g vercel
vercel
vercel env add OPENAI_API_KEY
vercel --prod
```

If you connect the repo through the Vercel dashboard, set `OPENAI_API_KEY` in Project Settings -> Environment Variables. Vercel will serve `public/index.html` and the API routes in `api/`.

Large floorplan screenshots can exceed hosted function body limits. If Vercel rejects a large upload, downscale/compress the image before sending it to the API.

## Python snippet equivalent

If you also want the exact Python-style flow, use:

```bash
python3 scripts/responses_image_generate.py \
  --prompt "Generate an image of gray tabby cat hugging an otter with an orange scarf" \
  --model gpt-4.1-mini \
  --image-model gpt-image-2 \
  --out cat_and_otter.png
```

## Notes

- Mask behavior: the selected region is made transparent in the mask, so only that area is edited.
- This version uses rectangular selections for speed and reliability.
- Supported upload formats: PNG, JPG, WEBP.
- `gpt-image-2` is used by default for edits and generation when available on your API account.
- The UI has three generation types: detailed top-down layout, 3D design rendering, and multi-angle render set.

## API route

- `POST /api/edit`
  - Body: `imageDataUrl`, `maskDataUrl`, `prompt`, `model`, `action`, `quality`, `size`
  - Uses Responses API + `image_generation` tool with mask inpainting
  - Returns: `{ editedImageDataUrl, revisedPrompt, requestId }`

- `POST /api/generate`
  - Body: `prompt`, `model`, `imageModel`, `quality`, `size`
  - Uses Responses API with `tools: [{ type: "image_generation" }]`
  - Returns: `{ generatedImageDataUrl, revisedPrompt, requestId }`

- `POST /api/id-assist`
  - Body: `imageDataUrl`, optional `selection`, and interior brief fields
  - Uses Responses API vision (`input_image`) to produce interior-design analysis + edit prompt
  - Returns: `{ analysisText, suggestedPrompt, requestId }`
