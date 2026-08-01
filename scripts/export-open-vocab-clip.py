#!/usr/bin/env python3
"""Export CLIP ViT-B/32 vision tower + precomputed open-vocab text embeds.

Produces:
  models/vision/clip_vit_b32_vision.onnx
    input:  pixel_values [1, 3, 224, 224] float32 (CLIP-normalised by caller)
    output: image_embeds [1, 512] float32 (L2-normalised)
  models/vision/open_vocab_text_embeds.json
    { "breed:golden_retriever": [512 floats], "fur_color:black": [...], ... }

Usage:
  python scripts/export-open-vocab-clip.py
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


BREEDS = [
    "golden_retriever",
    "labrador",
    "german_shepherd",
    "shiba",
    "poodle",
    "bulldog",
    "husky",
    "beagle",
    "tabby",
]
FUR_COLORS = ["black", "white", "brown", "golden", "gray", "cream", "red"]
VEHICLE_COLORS = ["black", "white", "silver", "gray", "red", "blue", "green", "yellow"]


def prompts_for_banks() -> dict[str, str]:
    out: dict[str, str] = {}
    for b in BREEDS:
        out[f"breed:{b}"] = f"a photo of a {b.replace('_', ' ')} dog"
    for c in FUR_COLORS:
        out[f"fur_color:{c}"] = f"a photo of an animal with {c} fur"
    for c in VEHICLE_COLORS:
        out[f"vehicle_color:{c}"] = f"a photo of a {c} car"
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parent.parent
    parser.add_argument(
        "--out-onnx",
        type=Path,
        default=root / "models" / "vision" / "clip_vit_b32_vision.onnx",
    )
    parser.add_argument(
        "--out-text",
        type=Path,
        default=root / "models" / "vision" / "open_vocab_text_embeds.json",
    )
    args = parser.parse_args()
    args.out_onnx.parent.mkdir(parents=True, exist_ok=True)

    import torch
    from transformers import CLIPModel, CLIPProcessor

    model_id = "openai/clip-vit-base-patch32"
    print(f"Loading {model_id}...")
    model = CLIPModel.from_pretrained(model_id)
    processor = CLIPProcessor.from_pretrained(model_id)
    model.eval()

    class VisionWrapper(torch.nn.Module):
        def __init__(self, inner: CLIPModel) -> None:
            super().__init__()
            self.inner = inner

        def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
            feats = self.inner.get_image_features(pixel_values=pixel_values)
            return feats / feats.norm(dim=-1, keepdim=True)

    wrapper = VisionWrapper(model)
    dummy = torch.randn(1, 3, 224, 224)
    print(f"Exporting vision ONNX → {args.out_onnx}")
    torch.onnx.export(
        wrapper,
        dummy,
        str(args.out_onnx),
        input_names=["pixel_values"],
        output_names=["image_embeds"],
        dynamic_axes=None,
        opset_version=17,
    )

    prompts = prompts_for_banks()
    texts = list(prompts.values())
    keys = list(prompts.keys())
    print(f"Encoding {len(texts)} text prompts...")
    with torch.no_grad():
        inputs = processor(text=texts, return_tensors="pt", padding=True)
        text_feats = model.get_text_features(**inputs)
        text_feats = text_feats / text_feats.norm(dim=-1, keepdim=True)
    payload = {
        key: text_feats[i].cpu().tolist() for i, key in enumerate(keys)
    }
    args.out_text.write_text(json.dumps(payload), encoding="utf-8")
    print(f"Wrote text embeds → {args.out_text}")
    print("Done.")


if __name__ == "__main__":
    main()
