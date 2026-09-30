import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  contributor: vi.fn(),
  limit: vi.fn(),
  current: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/env", () => ({ getPublicConfig: mocks.config }));
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
      list: (folder: string) => mocks.list(bucket, folder),
    }),
  },
};

function request(
  method: "POST" | "DELETE",
  body?: BodyInit,
  origin: string | null = "https://codebox.test",
) {
  return new NextRequest("https://codebox.test/api/avatar", {
    method,
    body,
    headers: origin ? { origin } : {},
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as ConstructorParameters<typeof NextRequest>[1]);
}
const png = async () =>
  new Uint8Array(
    await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#123" },
    })
      .png()
      .toBuffer(),
  );

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.config.mockReturnValue({
    url: "https://db.codebox.test",
    siteUrl: "https://codebox.test",
  });
  mocks.contributor.mockResolvedValue({
    ok: true,
    user: { id: USER },
    supabase,
  });
  mocks.current.mockResolvedValue({ data: { avatar: `${USER}/old.webp` } });
  mocks.update.mockResolvedValue({ error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.list.mockResolvedValue({ data: [], error: null });
});
const folderHasOld = () =>
  mocks.list.mockResolvedValue({ data: [{ name: "old.webp" }], error: null });

describe("authorize (both methods)", () => {
  it.each(["POST", "DELETE"] as const)(
    "%s returns 503 when Supabase is not configured, before auth",
    async (method) => {
      mocks.config.mockReturnValue(null);
      const handler = method === "POST" ? POST : DELETE;
      const response = await handler(
        request(method, method === "POST" ? "x" : undefined),
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks.contributor).not.toHaveBeenCalled();
    },
  );

  it("DELETE refuses other or missing origins and signed-out users", async () => {
    expect(
      (await DELETE(request("DELETE", undefined, "https://evil.test"))).status,
    ).toBe(403);
    expect((await DELETE(request("DELETE", undefined, null))).status).toBe(403);
    mocks.contributor.mockResolvedValue({
      ok: false,
      error: "Sign in to continue.",
    });
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in to continue." });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("POST refuses a request with no Origin header", async () => {
    expect((await POST(request("POST", await png(), null))).status).toBe(403);
    expect(mocks.contributor).not.toHaveBeenCalled();
  });
});

describe("POST /api/avatar error paths", () => {
  it("returns 503 (not 429) for non-rate-limit limiter failures", async () => {
    mocks.limit.mockRejectedValue(new MovieError(503, "limiter down"));
    expect((await POST(request("POST", await png()))).status).toBe(503);
    mocks.limit.mockRejectedValue(new Error("network"));
    expect((await POST(request("POST", await png()))).status).toBe(503);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("rejects an empty body with 400", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose an image to upload.",
    });
  });

  it("rejects a corrupt image with 422", async () => {
    const bytes = (await png()).subarray(0, 40);
    expect((await POST(request("POST", bytes))).status).toBe(422);
  });

  it("stops reading a streamed body (no Content-Length) past 2 MB", async () => {
    let pulls = 0;
    const chunk = new Uint8Array(512 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls > 20) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const response = await POST(request("POST", stream));
    expect(response.status).toBe(413);
    expect(pulls).toBeLessThan(10);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("returns 503 and changes nothing when the storage upload fails", async () => {
    mocks.upload.mockResolvedValue({ error: { statusCode: "500" } });
    const response = await POST(request("POST", await png()));
    expect(response.status).toBe(503);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("does not try to remove a previous file when there was none", async () => {
    mocks.current.mockResolvedValue({ data: { avatar: null } });
    const response = await POST(request("POST", await png()));
    expect(response.status).toBe(200);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("still succeeds when removing the old file fails (best effort)", async () => {
    folderHasOld();
    mocks.remove.mockResolvedValue({ error: { statusCode: "500" } });
    expect((await POST(request("POST", await png()))).status).toBe(200);
  });

  it("rate-limits with the avatar scope and the session user id", async () => {
    await POST(request("POST", await png()));
    expect(mocks.limit).toHaveBeenCalledWith(
      "avatar",
      expect.any(Headers),
      USER,
    );
  });
});

describe("DELETE /api/avatar error paths", () => {
  it("returns 503 and keeps the file when the profile update fails", async () => {
    mocks.update.mockResolvedValue({ error: { code: "57014" } });
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "We couldn't remove your avatar. Try again.",
    });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("succeeds without touching storage when there is no avatar", async () => {
    mocks.current.mockResolvedValue({ data: { avatar: null } });
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ avatar: null });
    expect(mocks.update).toHaveBeenCalledWith({ avatar: null }, USER);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("still succeeds when the folder can't be listed (sweeping is best effort)", async () => {
    mocks.list.mockResolvedValue({ data: null, error: { statusCode: "500" } });
    expect((await POST(request("POST", await png()))).status).toBe(200);
    expect((await DELETE(request("DELETE"))).status).toBe(200);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("still reports success when the storage removal fails", async () => {
    folderHasOld();
    mocks.remove.mockResolvedValue({ error: { statusCode: "500" } });
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("is not rate-limited and never reads a body", async () => {
    await DELETE(request("DELETE"));
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
