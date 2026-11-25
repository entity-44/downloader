import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createVideoThumbnail, ffmpegAvailable, parseFfmpegInfo, probeVideo } from "@/lib/media/ffmpeg";
import { sniffBuffer, sniffFile } from "@/lib/media/sniff";
import { storeMediaFile } from "@/lib/downloads/store";
import { downloadFilename } from "@/lib/media/filenames";
import { mediaFixtures } from "./helpers";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "media-"));

describe("content sniffing", () => {
  it("identifies real media by magic bytes", async () => {
    const f = mediaFixtures();
    expect(sniffBuffer(f.jpg)).toMatchObject({ mime: "image/jpeg", kind: "IMAGE" });
    expect(sniffBuffer(f.png)).toMatchObject({ mime: "image/png", kind: "IMAGE" });
    expect(sniffBuffer(f.mp4)).toMatchObject({ mime: "video/mp4", kind: "VIDEO" });
    const d = tmp();
    writeFileSync(path.join(d, "x"), f.mp4);
    expect((await sniffFile(path.join(d, "x")))?.ext).toBe("mp4");
  });
  it("rejects non-media regardless of extension", () => {
    expect(sniffBuffer(Buffer.from("<html><script>"))).toBeNull();
    expect(sniffBuffer(Buffer.from("MZ\x90\x00"))).toBeNull();
    expect(sniffBuffer(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(sniffBuffer(Buffer.from("\x7fELF"))).toBeNull();
    expect(sniffBuffer(Buffer.alloc(0))).toBeNull();
  });
});

describe("ffmpeg processing", () => {
  it("is available (bundled or system)", async () => {
    expect(await ffmpegAvailable()).toBe(true);
  });
  it("probes duration and dimensions", async () => {
    const d = tmp();
    const v = path.join(d, "v.mp4");
    writeFileSync(v, mediaFixtures().mp4);
    const info = await probeVideo(v);
    expect(info?.width).toBe(160);
    expect(info?.height).toBe(120);
    expect(info?.durationSec).toBeCloseTo(3, 0);
  });
  it("creates a JPEG poster frame", async () => {
    const d = tmp();
    const v = path.join(d, "v.mp4");
    writeFileSync(v, mediaFixtures().mp4);
    const out = path.join(d, "t.jpg");
    expect(await createVideoThumbnail(v, out, 3)).toBe(true);
    expect((await sniffFile(out))?.mime).toBe("image/jpeg");
  });
  it("fails gracefully on corrupt video", async () => {
    const d = tmp();
    const v = path.join(d, "bad.mp4");
    writeFileSync(v, Buffer.concat([mediaFixtures().mp4.subarray(0, 64)]));
    expect(await createVideoThumbnail(v, path.join(d, "t.jpg"))).toBe(false);
  });
  it("parses ffmpeg stderr", () => {
    expect(parseFfmpegInfo("Duration: 00:01:02.50, start: 0\n Stream #0:0: Video: h264, yuv420p, 1080x1920")).toEqual({ durationSec: 62.5, width: 1080, height: 1920 });
  });
});

describe("storeMediaFile", () => {
  it("stores validated media with the sniffed extension", async () => {
    const { getConfig } = await import("@/lib/config");
    const src = path.join(tmp(), "upload");
    writeFileSync(src, mediaFixtures().mp4);
    const dest = path.join(getConfig().storageDir, "users", "u1", "downloads", "d1");
    const s = await storeMediaFile(src, dest, "clip");
    expect(s.storagePath).toBe("users/u1/downloads/d1/clip.mp4");
    expect(s.thumbPath).toBe("users/u1/downloads/d1/.thumbs/clip.jpg");
    expect(existsSync(src)).toBe(false);
  });
  it("rejects and deletes non-media", async () => {
    const src = path.join(tmp(), "upload");
    writeFileSync(src, "<?php system($_GET['c']); ?>");
    await expect(storeMediaFile(src, tmp(), "x")).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    expect(existsSync(src)).toBe(false);
  });
});

describe("filenames", () => {
  it("are meaningful and safe", () => {
    expect(downloadFilename({ username: "my.account", kind: "reel", shortcode: "C9abc", takenAt: new Date("2024-05-01T10:00:00Z"), index: 1, total: 3, ext: "mp4" })).toBe("instagram_my.account_reel_C9abc_2024-05-01_02.mp4");
    expect(downloadFilename({ username: "../x", kind: "post", index: 0, total: 1, ext: "jpg" })).toBe("instagram_x_post.jpg");
  });
});
