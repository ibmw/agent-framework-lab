import type { ShopMediaAssetSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import { MEDIA_TOO_LARGE_RULE, MEDIA_TYPE_RULE } from "./fieldRules";
import {
  assetOf,
  assetReference,
  formatByteSize,
  libraryOf,
  localMediaRefusal,
  mediaFacts,
  mediaNames,
} from "./media";

const OCEAN = "0f".repeat(32);
const SEAMS = "a1".repeat(32);
const COPY = "b2".repeat(32);

function asset(sha256: string, fileName: string): ShopMediaAssetSchema {
  return {
    reference: assetReference(sha256),
    sha256,
    content_type: "image/jpeg",
    byte_size: 12_800,
    file_name: fileName,
    created_at: "2026-10-02T09:00:00Z",
  };
}

const LIBRARY = libraryOf([
  asset(OCEAN, "ocean-blue-front.jpg"),
  asset(SEAMS, "seams.jpg"),
  asset(COPY, "ocean-blue-front.jpg"),
]);

describe("a product's images, named as the list names them", () => {
  it("reads the hash out of an asset reference and nothing out of a written one", () => {
    expect(assetOf(assetReference(OCEAN))).toBe(OCEAN);
    expect(assetOf("media/alpine-shell.jpg")).toBeNull();
    expect(assetOf(`asset:sha256:${OCEAN.toUpperCase()}`)).toBeNull();
    expect(assetOf(`asset:sha256:${OCEAN}0`)).toBeNull();
  });

  it("names each entry by its file name", () => {
    const names = mediaNames(
      [
        { reference: assetReference(OCEAN), alt_text: "Front" },
        { reference: assetReference(SEAMS), alt_text: "Seams" },
      ],
      LIBRARY,
    );

    expect([...names.values()]).toEqual(["ocean-blue-front.jpg", "seams.jpg"]);
  });

  it("tells two entries of one file name apart by the first eight digits of their hashes", () => {
    const names = mediaNames(
      [
        { reference: assetReference(OCEAN), alt_text: "Front" },
        { reference: assetReference(COPY), alt_text: "Front again" },
        { reference: assetReference(SEAMS), alt_text: "Seams" },
      ],
      LIBRARY,
    );

    expect([...names.values()]).toEqual([
      "ocean-blue-front.jpg (0f0f0f0f)",
      "ocean-blue-front.jpg (b2b2b2b2)",
      "seams.jpg",
    ]);
  });

  it("names an image the shop does not list by its hash, and a written reference by itself", () => {
    const unknown = "c3".repeat(32);
    const names = mediaNames(
      [
        { reference: assetReference(unknown), alt_text: "Gone" },
        { reference: "media/alpine-shell.jpg", alt_text: "Written" },
      ],
      LIBRARY,
    );

    expect([...names.values()]).toEqual(["image c3c3c3c3", "media/alpine-shell.jpg"]);
  });

  it("says an image's type and size after its alt text", () => {
    expect(mediaFacts(asset(OCEAN, "a.jpg"))).toBe("JPEG · 12.5 KB");
    expect(formatByteSize(900)).toBe("900 B");
    expect(formatByteSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("a file refused before it uploads", () => {
  it("refuses a type the browser knows is not PNG, JPEG or WebP, in the lab's words", () => {
    expect(localMediaRefusal(new File(["GIF89a"], "a.gif", { type: "image/gif" }))).toBe(
      MEDIA_TYPE_RULE,
    );
    expect(localMediaRefusal(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }))).toBe(
      MEDIA_TYPE_RULE,
    );
    expect(localMediaRefusal(new File(["x"], "a.png", { type: "image/png" }))).toBeNull();
    // A type the browser cannot name is the lab's to tell from the first bytes.
    expect(localMediaRefusal(new File(["x"], "photo", { type: "" }))).toBeNull();
  });

  it("refuses a file past the cap and takes one at it", () => {
    const at = new File([new Uint8Array(5 * 1024 * 1024)], "a.jpg", { type: "image/jpeg" });
    const past = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "b.jpg", { type: "image/jpeg" });

    expect(localMediaRefusal(at)).toBeNull();
    expect(localMediaRefusal(past)).toBe(MEDIA_TOO_LARGE_RULE);
  });
});
