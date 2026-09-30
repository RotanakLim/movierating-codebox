import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
import {
  AVATAR_MAX_BYTES,
  AvatarError,
  processAvatar,
  sniffImageType,
} from "@/lib/settings/avatar";

const image = (width = 400, height = 300) =>
  sharp({
    create: { width, height, channels: 3, background: "#2a9d8f" },
  });

async function rejects(bytes: Uint8Array, status: number) {
  const error = await processAvatar(bytes).catch((caught) => caught);
  expect(error).toBeInstanceOf(AvatarError);
  expect(error.status).toBe(status);
}

describe("avatar processing", () => {
  it("identifies JPEG, PNG and WebP by their bytes only", async () => {
    expect(sniffImageType(await image().jpeg().toBuffer())).toBe("jpeg");
    expect(sniffImageType(await image().png().toBuffer())).toBe("png");
    expect(sniffImageType(await image().webp().toBuffer())).toBe("webp");
    expect(sniffImageType(await image().gif().toBuffer())).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<svg></svg>"))).toBeNull();
  });

  it.each(["jpeg", "png", "webp"] as const)(
    "re-encodes %s to a 256px square WebP without metadata",
    async (format) => {
      const input = await image()
        .withExif({ IFD0: { Copyright: "secret location" } })
        [format]()
        .toBuffer();
      const output = await processAvatar(new Uint8Array(input));
      const meta = await sharp(output).metadata();
      expect(meta).toMatchObject({ format: "webp", width: 256, height: 256 });
      expect(meta.exif).toBeUndefined();
    },
  );

  it("refuses SVG, GIF, empty, oversized and corrupt files", async () => {
    await rejects(
      new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
      415,
    );
    await rejects(new Uint8Array(await image().gif().toBuffer()), 415);
    await rejects(new Uint8Array(), 400);
    await rejects(new Uint8Array(AVATAR_MAX_BYTES + 1), 413);
    const png = await image().png().toBuffer();
    await rejects(new Uint8Array(png.subarray(0, 40)), 422);
  });

  it("refuses images with an enormous pixel count before decoding", async () => {
    const huge = await sharp({
      create: { width: 8000, height: 8000, channels: 3, background: "#000" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(huge.length).toBeLessThan(AVATAR_MAX_BYTES);
    await rejects(new Uint8Array(huge), 422);
  });
});
