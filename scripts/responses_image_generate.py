from openai import OpenAI
import base64
import argparse


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate an image using Responses API image_generation tool"
    )
    parser.add_argument(
        "--prompt",
        default="Generate an image of gray tabby cat hugging an otter with an orange scarf",
        help="Prompt to generate"
    )
    parser.add_argument("--model", default="gpt-4.1-mini", help="Responses model")
    parser.add_argument("--image-model", default="gpt-image-2", help="Image generation model")
    parser.add_argument("--out", default="generated.png", help="Output image path")
    args = parser.parse_args()

    client = OpenAI()

    response = client.responses.create(
        model=args.model,
        input=args.prompt,
        tools=[{"type": "image_generation", "model": args.image_model}],
        tool_choice={"type": "image_generation"},
    )

    image_data = [
        output.result
        for output in response.output
        if output.type == "image_generation_call"
    ]

    if not image_data:
        raise RuntimeError("No image returned by API")

    with open(args.out, "wb") as f:
        f.write(base64.b64decode(image_data[0]))

    print(f"Saved: {args.out}")


if __name__ == "__main__":
    main()
