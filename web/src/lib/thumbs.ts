/** Browser-side thumbnails (replaces FFmpeg for previews). */
const MAX = 960;

async function canvasToJpeg(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): Promise<Blob | null> {
  const scale = Math.min(1, MAX / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  draw(ctx, cw, ch);
  return new Promise((r) => canvas.toBlob((b) => r(b), "image/jpeg", 0.8));
}

export async function imageThumb(blob: Blob): Promise<{ thumb: Blob | null; width?: number; height?: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const thumb = await canvasToJpeg((ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h), bmp.width, bmp.height);
    const res = { thumb, width: bmp.width, height: bmp.height };
    bmp.close();
    return res;
  } catch {
    return { thumb: null }; // e.g. HEIC outside Safari
  }
}

export function videoThumb(blob: Blob): Promise<{ thumb: Blob | null; width?: number; height?: number; durationSec?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    let done = false;
    const finish = (r: { thumb: Blob | null; width?: number; height?: number; durationSec?: number }) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      v.load();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ thumb: null }), 15_000);
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 0) / 3);
    };
    v.onseeked = async () => {
      clearTimeout(timer);
      const thumb = await canvasToJpeg((ctx, w, h) => ctx.drawImage(v, 0, 0, w, h), v.videoWidth || 320, v.videoHeight || 240);
      finish({ thumb, width: v.videoWidth, height: v.videoHeight, durationSec: Number.isFinite(v.duration) ? v.duration : undefined });
    };
    v.onerror = () => {
      clearTimeout(timer);
      finish({ thumb: null });
    };
    v.src = url;
  });
}

export async function makeThumb(blob: Blob, kind: "IMAGE" | "VIDEO") {
  return kind === "VIDEO" ? videoThumb(blob) : imageThumb(blob);
}
