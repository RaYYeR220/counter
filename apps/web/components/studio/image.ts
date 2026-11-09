// Product photos are resized in the browser before upload: at most 1600 px
// on the long side, as JPEG, under the server's 1 MB limit for imports.

const MAX_SIDE = 1600;
const TARGET_BYTES = 900 * 1024;

export interface PreparedPhoto {
  file: File;
  width: number;
  height: number;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** A JPEG of the photo no larger than 1600 px and about 900 KB, or an error a person can act on. */
export async function preparePhoto(input: File): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(input, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This browser can't read that file as an image. Use a JPEG, PNG or WebP photo.");
  }
  let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  let quality = 0.86;
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser can't resize photos. Try a smaller JPEG.");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await toBlob(canvas, quality);
      if (blob && blob.size <= TARGET_BYTES) {
        const base = input.name.replace(/\.[a-z0-9]+$/i, "") || "photo";
        return { file: new File([blob], `${base}.jpg`, { type: "image/jpeg" }), width, height };
      }
      if (quality > 0.62) quality -= 0.12;
      else {
        scale *= 0.8;
        quality = 0.8;
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("That photo stays over 1 MB even after resizing. Try a simpler or smaller photo.");
}
