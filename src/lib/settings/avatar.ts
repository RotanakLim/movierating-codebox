import "server-only";
import sharp from "sharp";
import { AVATAR_MAX_BYTES } from "./avatar-limits";

export { AVATAR_MAX_BYTES };
export const AVATAR_SIZE = 256;

export class AvatarError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const FORMAT_MESSAGE = "Choose a JPEG, PNG or WebP image.";

/** Identify the file by its bytes, never by its name or the browser's MIME type. */
export function sniffImageType(
  bytes: Uint8Array,
): "jpeg" | "png" | "webp" | null {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => bytes[index] === byte,
    )
  )
    return "png";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")
    return "webp";
  return null;
}

/**
 * Validate an uploaded avatar and re-encode it as a square WebP. Only the first
 * frame is decoded, metadata (EXIF, GPS, colour profiles) is dropped, and huge
 * pixel counts are refused before decoding.
 */
export async function processAvatar(bytes: Uint8Array): Promise<Buffer> {
  if (!bytes.length) throw new AvatarError(400, "Choose an image to upload.");
  if (bytes.length > AVATAR_MAX_BYTES)
    throw new AvatarError(413, "Images can be up to 2 MB.");
  const sniffed = sniffImageType(bytes);
  if (!sniffed) throw new AvatarError(415, FORMAT_MESSAGE);
  try {
    const image = sharp(bytes, {
      limitInputPixels: 4096 * 4096,
      failOn: "error",
      animated: false,
    });
    const { format, width, height } = await image.metadata();
    if (format !== sniffed || !width || !height)
      throw new AvatarError(415, FORMAT_MESSAGE);
    return await image
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (error) {
    if (error instanceof AvatarError) throw error;
    throw new AvatarError(422, "That image couldn't be read. Try another.");
  }
}
