import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({
  contributor: vi.fn(),
  limit: vi.fn(),
  current: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/env", () => ({
  getPublicConfig: () => ({
    url: "https://db.codebox.test",
    siteUrl: "https://codebox.test",
  }),
}));
vi.mock("@/lib/movies/limits", () => ({ limitMovieRequest: mocks.limit }));
vi.mock("@/lib/auth/contributor", () => ({
  requireContributor: mocks.contributor,
}));
import { DELETE, POST } from "@/app/api/avatar/route";
import { MovieError } from "@/lib/movies/errors";

const USER = "11111111-1111-4111-8111-111111111111";
const supabase = {
  from: () => ({
    select: () => ({ eq: () => ({ single: mocks.current }) }),
    update: (values: unknown) => ({
      eq: (_column: string, id: string) => mocks.update(values, id),
    }),
  }),
  storage: {
    from: (bucket: string) => ({
      upload: (...args: unknown[]) => mocks.upload(bucket, ...args),
      remove: (paths: string[]) => mocks.remove(bucket, paths),
    }),
  },
};

function request(
  method: "POST" | "DELETE",
  body?: BodyInit,
  origin = "https://codebox.test",
) {
  return new NextRequest("https://codebox.test/api/avatar", {
    method,
    body,
    headers: { origin },
  });
}
const png = () =>
  sharp({
    create: { width: 64, height: 64, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.contributor.mockResolvedValue({
    ok: true,
    user: { id: USER },
    supabase,
  });
  mocks.current.mockResolvedValue({
    data: { avatar: `${USER}/old.webp` },
  });
  mocks.update.mockResolvedValue({ error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
});

describe("POST /api/avatar", () => {
  it("refuses other origins and signed-out users before reading the body", async () => {
    expect((await POST(request("POST", "x", "https://evil.test"))).status).toBe(
      403,
    );
    mocks.contributor.mockResolvedValue({
      ok: false,
      error: "Sign in to continue.",
    });
    const response = await POST(request("POST", "x"));
    expect(response.status).toBe(401);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("stores a re-encoded WebP in the user's folder and removes the old one", async () => {
    const response = await POST(request("POST", new Uint8Array(await png())));
    expect(response.status).toBe(200);
    const [bucket, path, bytes, options] = mocks.upload.mock.calls[0];
    expect(bucket).toBe("avatars");
    expect(path).toMatch(new RegExp(`^${USER}/[0-9a-f-]{36}\\.webp$`));
    expect((await sharp(bytes).metadata()).format).toBe("webp");
    expect(options).toMatchObject({ contentType: "image/webp", upsert: false });
    expect(mocks.update).toHaveBeenCalledWith({ avatar: path }, USER);
    expect(mocks.remove).toHaveBeenCalledWith("avatars", [`${USER}/old.webp`]);
    expect(await response.json()).toEqual({
      avatar: `https://db.codebox.test/storage/v1/object/public/avatars/${path}`,
    });
  });

  it("rejects non-images and oversized bodies without storing anything", async () => {
    const svg = await POST(request("POST", "<svg></svg>"));
    expect(svg.status).toBe(415);
    const big = await POST(
      request("POST", new Uint8Array(2 * 1024 * 1024 + 1)),
    );
    expect(big.status).toBe(413);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("applies the upload rate limit", async () => {
    mocks.limit.mockRejectedValue(new MovieError(429, "slow down"));
    const response = await POST(request("POST", new Uint8Array(await png())));
    expect(response.status).toBe(429);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("removes the new file if the profile can't be updated", async () => {
    mocks.update.mockResolvedValue({ error: { code: "23514" } });
    const response = await POST(request("POST", new Uint8Array(await png())));
    expect(response.status).toBe(503);
    const path = mocks.upload.mock.calls[0][1];
    expect(mocks.remove).toHaveBeenCalledWith("avatars", [path]);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
});

describe("DELETE /api/avatar", () => {
  it("clears the avatar and removes the file", async () => {
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ avatar: null }, USER);
    expect(mocks.remove).toHaveBeenCalledWith("avatars", [`${USER}/old.webp`]);
  });
});
