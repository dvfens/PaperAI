import "server-only";
import { HttpError } from "@/server/http";

export interface DecodedImage {
  bytes: Buffer;
  mediaType: "image/jpeg" | "image/png";
  width: number;
  height: number;
}

/** Decode a data: URL produced in the browser and check it really is a JPEG or PNG. */
export function decodeImageDataUrl(dataUrl: string, maxBytes = 8_000_000): DecodedImage {
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, "bad_image", "Images must be JPEG or PNG data URLs.");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > maxBytes) throw new HttpError(413, "image_too_large", "Image too large.");
  const size = imageSize(bytes);
  if (!size) throw new HttpError(400, "bad_image", "Could not read the image.");
  return { bytes, mediaType: size.type, width: size.width, height: size.height };
}

/** Validate raw uploaded image bytes (multipart upload). */
export function decodeImageBytes(bytes: Buffer, maxBytes = 8_000_000): DecodedImage {
  if (bytes.length > maxBytes) throw new HttpError(413, "image_too_large", "Image too large.");
  const size = imageSize(bytes);
  if (!size) throw new HttpError(400, "bad_image", "Images must be JPEG or PNG.");
  if (size.width < 50 || size.height < 50 || size.width > 6000 || size.height > 6000) {
    throw new HttpError(400, "bad_image", "Image dimensions are out of range.");
  }
  return { bytes, mediaType: size.type, width: size.width, height: size.height };
}

/** Reads dimensions from PNG IHDR or JPEG SOF markers (validates the magic bytes too). */
export function imageSize(buf: Buffer): { type: "image/png" | "image/jpeg"; width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    return { type: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) return null;
      const marker = buf[off + 1];
      const len = buf.readUInt16BE(off + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: "image/jpeg", height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      off += 2 + len;
    }
  }
  return null;
}

export function isPdf(buf: Uint8Array): boolean {
  return buf.length > 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d;
}
