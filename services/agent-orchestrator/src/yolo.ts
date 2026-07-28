/**
 * YOLO11 output decoding — the pure math, separated from the runtime.
 *
 * The ONNX session hands back a `[1, 84, 8400]` tensor: 4 box coordinates
 * plus 80 COCO class scores for each of 8400 candidate anchors. Everything
 * that turns that into labelled boxes lives here as pure functions, so the
 * decoding and non-maximum suppression are testable without loading a model
 * or an image.
 */

/** The 80 COCO class names, in the model's output order. */
export const COCO_CLASSES = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train",
  "truck", "boat", "traffic light", "fire hydrant", "stop sign",
  "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
  "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag",
  "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
  "baseball bat", "baseball glove", "skateboard", "surfboard",
  "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon",
  "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot",
  "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant",
  "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote",
  "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
  "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
  "hair drier", "toothbrush",
] as const;

/**
 * COCO label → this system's class vocabulary. Classes COCO cannot see
 * (drone) simply never come from this detector; the VLM path can still name
 * them. Unmapped COCO labels are reported under their COCO name so nothing
 * detected is hidden.
 */
const CLASS_MAP: Record<string, string> = {
  person: "person",
  bicycle: "bicycle",
  motorcycle: "bicycle",
  car: "car",
  bus: "truck",
  truck: "truck",
  bird: "bird",
  cat: "cat",
  dog: "dog",
  backpack: "package",
  suitcase: "package",
};

/** Map a COCO label into the system vocabulary. */
export function mapClass(cocoLabel: string): string {
  return CLASS_MAP[cocoLabel] ?? cocoLabel;
}

/** One decoded detection, in normalised image coordinates (0..1). */
export interface YoloDetection {
  /** System-vocabulary class (see `mapClass`). */
  class: string;
  /** Raw COCO label the model actually emitted. */
  cocoLabel: string;
  /** Model confidence for that class, 0..1. */
  confidence: number;
  /** Box in fractions of the image: left x, top y, width, height. */
  bbox: { x: number; y: number; width: number; height: number };
}

/** Intersection-over-union of two normalised boxes. */
export function iou(
  a: YoloDetection["bbox"],
  b: YoloDetection["bbox"],
): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Greedy per-class non-maximum suppression.
 *
 * Highest confidence wins; boxes of the same class overlapping a winner
 * beyond `iouThreshold` are dropped. Different classes never suppress each
 * other — a dog sitting in a chair is two detections, not one.
 */
export function nms(detections: YoloDetection[], iouThreshold = 0.45): YoloDetection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: YoloDetection[] = [];
  for (const candidate of sorted) {
    const overlaps = kept.some(
      (k) => k.cocoLabel === candidate.cocoLabel && iou(k.bbox, candidate.bbox) > iouThreshold,
    );
    if (!overlaps) kept.push(candidate);
  }
  return kept;
}

/**
 * Decode a raw YOLO11 output tensor into detections.
 *
 * @param data the flat `[1, 84, N]` tensor values (transposed layout:
 *   attribute-major, so value for attribute `a` of anchor `i` is
 *   `data[a * anchors + i]`)
 * @param anchors number of candidate anchors (8400 at 640×640)
 * @param inputSize the square model input size the coordinates are in
 * @param minConfidence anchors below this are discarded before NMS
 */
export function decode(
  data: Float32Array | number[],
  anchors: number,
  inputSize: number,
  minConfidence = 0.4,
): YoloDetection[] {
  const out: YoloDetection[] = [];
  for (let i = 0; i < anchors; i += 1) {
    let best = 0;
    let bestClass = -1;
    for (let c = 0; c < COCO_CLASSES.length; c += 1) {
      const score = Number(data[(4 + c) * anchors + i]);
      if (score > best) {
        best = score;
        bestClass = c;
      }
    }
    if (best < minConfidence || bestClass < 0) continue;

    const cx = Number(data[i]);
    const cy = Number(data[anchors + i]);
    const w = Number(data[2 * anchors + i]);
    const h = Number(data[3 * anchors + i]);
    if (![cx, cy, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;

    const cocoLabel = COCO_CLASSES[bestClass] ?? "unknown";
    out.push({
      class: mapClass(cocoLabel),
      cocoLabel,
      confidence: best,
      bbox: {
        x: Math.max(0, (cx - w / 2) / inputSize),
        y: Math.max(0, (cy - h / 2) / inputSize),
        width: Math.min(1, w / inputSize),
        height: Math.min(1, h / inputSize),
      },
    });
  }
  return nms(out);
}
