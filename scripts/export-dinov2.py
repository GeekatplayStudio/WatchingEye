#!/usr/bin/env python3
"""Export DINOv2-small to ONNX for WatchingEye appearance ReID.

Produces models/vision/dinov2_vits14.onnx with:
  input:  pixel_values  [1, 3, 224, 224] float32 (ImageNet-normalised by caller)
  output: last_hidden_state [1, tokens, 384]

Usage:
  python scripts/export-dinov2.py
  python scripts/export-dinov2.py --out path/to/dinov2_vits14.onnx
"""
from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parent.parent
    parser.add_argument(
        "--out",
        type=Path,
        default=root / "models" / "vision" / "dinov2_vits14.onnx",
    )
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)

    import torch
    from transformers import AutoModel

    model_id = "facebook/dinov2-small"
    print(f"Loading {model_id}...")
    model = AutoModel.from_pretrained(model_id)
    model.eval()

    class Wrapper(torch.nn.Module):
        def __init__(self, inner: torch.nn.Module) -> None:
            super().__init__()
            self.inner = inner

        def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
            return self.inner(pixel_values=pixel_values).last_hidden_state

    wrapped = Wrapper(model)
    dummy = torch.randn(1, 3, 224, 224)
    print(f"Exporting ONNX to {args.out}...")
    torch.onnx.export(
        wrapped,
        dummy,
        str(args.out),
        input_names=["pixel_values"],
        output_names=["last_hidden_state"],
        dynamic_axes={
            "pixel_values": {0: "batch"},
            "last_hidden_state": {0: "batch"},
        },
        opset_version=17,
    )
    print(f"Wrote {args.out} ({args.out.stat().st_size // (1024 * 1024)} MB)")


if __name__ == "__main__":
    main()
