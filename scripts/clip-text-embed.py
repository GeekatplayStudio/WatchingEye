#!/usr/bin/env python3
"""Encode free-form text with CLIP ViT-B/32 (ROADMAP 6.4 soft path).

Stdout JSON:
  {"values":[512 floats],"model":"clip-vit-b32","dim":512}

Usage:
  python scripts/clip-text-embed.py --text "a golden retriever dog"

Requires: pip install torch transformers  (soft-empty / exit 0 on miss)
"""
from __future__ import annotations

import argparse
import json
import sys


def emit(values: list[float], model: str) -> None:
    print(json.dumps({"values": values, "model": model, "dim": len(values)}))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text", type=str, required=True)
    args = parser.parse_args()
    text = (args.text or "").strip()
    if not text:
        emit([], "clip-empty")
        return 0

    try:
        import torch
        from transformers import CLIPModel, CLIPProcessor
    except Exception:
        emit([], "clip-transformers-unavailable")
        return 0

    try:
        model_id = "openai/clip-vit-base-patch32"
        model = CLIPModel.from_pretrained(model_id)
        processor = CLIPProcessor.from_pretrained(model_id)
        model.eval()
        with torch.no_grad():
            inputs = processor(text=[text], return_tensors="pt", padding=True)
            feats = model.get_text_features(**inputs)
            feats = feats / feats.norm(dim=-1, keepdim=True)
        values = feats[0].cpu().tolist()
        emit(values, "clip-vit-b32")
        return 0
    except Exception:
        emit([], "clip-text-error")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
