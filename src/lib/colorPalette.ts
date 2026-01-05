export type PaletteExtractionOptions = {
  /**
   * Desired number of colors in the output palette.
   * Default: 6
   */
  maxColors?: number;
  /**
   * Downsample size (largest dimension) for analysis.
   * Default: 96
   */
  sampleSize?: number;
  /**
   * Pixels with alpha below this threshold are ignored (0-255).
   * Default: 32
   */
  minAlpha?: number;
  /**
   * Minimum RGB distance between selected colors to reduce near-duplicates.
   * Default: 28
   */
  minDistance?: number;
};

type Bin = { count: number; r: number; g: number; b: number };

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function componentToHex(n: number) {
  return clampInt(n, 0, 255).toString(16).padStart(2, "0").toUpperCase();
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

function rgbDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = dataUrl;

  // decode() is supported in modern browsers; fallback to load event.
  try {
    await img.decode();
    return img;
  } catch {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image"));
    });
    return img;
  }
}

/**
 * Fast, deterministic palette extraction from an image data URL using a quantized histogram.
 * No network/LLM required.
 */
export async function extractPaletteFromDataUrl(
  dataUrl: string,
  opts: PaletteExtractionOptions = {},
): Promise<string[]> {
  const maxColors = clampInt(opts.maxColors ?? 6, 1, 16);
  const sampleSize = clampInt(opts.sampleSize ?? 96, 16, 256);
  const minAlpha = clampInt(opts.minAlpha ?? 32, 0, 255);
  const minDistance = clampInt(opts.minDistance ?? 28, 0, 255);

  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || (img as any).width || 1;
  const h = img.naturalHeight || (img as any).height || 1;

  const scale = sampleSize / Math.max(w, h);
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.drawImage(img, 0, 0, cw, ch);
  const { data } = ctx.getImageData(0, 0, cw, ch);

  // Quantize to 5 bits/channel => 32^3 bins
  const bins = new Map<number, Bin>();

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < minAlpha) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const r5 = r >> 3;
    const g5 = g >> 3;
    const b5 = b >> 3;
    const key = (r5 << 10) | (g5 << 5) | b5;

    const bin = bins.get(key);
    if (!bin) {
      bins.set(key, { count: 1, r, g, b });
    } else {
      bin.count += 1;
      bin.r += r;
      bin.g += g;
      bin.b += b;
    }
  }

  const sorted = [...bins.values()].sort((a, b) => b.count - a.count);

  const picked: Array<{ r: number; g: number; b: number }> = [];
  for (const bin of sorted) {
    const c = {
      r: Math.round(bin.r / bin.count),
      g: Math.round(bin.g / bin.count),
      b: Math.round(bin.b / bin.count),
    };
    if (picked.every((p) => rgbDistance(p, c) >= minDistance)) {
      picked.push(c);
    }
    if (picked.length >= maxColors) break;
  }

  // Fallback if the image is tiny/monochrome/transparent
  if (picked.length === 0) {
    picked.push({ r: 0, g: 0, b: 0 });
  }

  return picked.map((c) => rgbToHex(c.r, c.g, c.b));
}


