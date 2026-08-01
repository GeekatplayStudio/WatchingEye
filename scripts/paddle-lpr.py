#!/usr/bin/env python3
"""Optional PaddleOCR plate read (ROADMAP 6.2 soft path).

Stdout is a single JSON object (never raises to the caller):
  {"text": "...", "confidence": 0.0-1.0, "modelVersion": "paddleocr-..."}

Usage:
  python scripts/paddle-lpr.py --image path/to.jpg
  python scripts/paddle-lpr.py --stdin-b64   # JPEG base64 on stdin

Requires: pip install paddlepaddle paddleocr  (optional; soft-empty otherwise)
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import tempfile
from pathlib import Path


def emit(text: str, confidence: float, model_version: str) -> None:
    print(
        json.dumps(
            {
                "text": text,
                "confidence": max(0.0, min(1.0, float(confidence))),
                "modelVersion": model_version,
            }
        )
    )


def load_image_path(args: argparse.Namespace) -> Path | None:
    if args.image:
        path = Path(args.image)
        return path if path.is_file() else None
    if args.stdin_b64:
        raw = sys.stdin.buffer.read()
        try:
            jpeg = base64.b64decode(raw, validate=False)
        except Exception:
            return None
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        tmp.write(jpeg)
        tmp.close()
        return Path(tmp.name)
    return None


def run_paddle(image: Path) -> tuple[str, float, str]:
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except Exception:
        return "", 0.0, "paddleocr-unavailable"

    try:
        # use_angle_cls helps rotated plates; show_log=False keeps stdout clean.
        ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        result = ocr.ocr(str(image), cls=True)
    except Exception:
        return "", 0.0, "paddleocr-error"

    best_text = ""
    best_conf = 0.0
    # result: list per image → list of [box, (text, conf)]
    if not result:
        return "", 0.0, "paddleocr"
    for block in result:
        if not block:
            continue
        for line in block:
            if not line or len(line) < 2:
                continue
            pair = line[1]
            if not pair or len(pair) < 2:
                continue
            text, conf = str(pair[0]), float(pair[1])
            if conf >= best_conf and text.strip():
                best_text, best_conf = text, conf
    return best_text, best_conf, "paddleocr"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=str, default=None)
    parser.add_argument("--stdin-b64", action="store_true")
    args = parser.parse_args()

    path = load_image_path(args)
    if path is None:
        emit("", 0.0, "paddleocr-no-image")
        return 0

    text, conf, ver = run_paddle(path)
    if args.stdin_b64:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass
    emit(text, conf, ver)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
