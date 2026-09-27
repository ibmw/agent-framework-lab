import { describe, expect, it } from "vitest";
import { newestVersion, versionOptionLabel } from "./versions";

describe("the newest published version", () => {
  const version = (number: number) => ({
    version: number,
    content_fingerprint: "f".repeat(64),
    published_at: "2026-09-01T08:00:00+00:00",
  });

  it.each([
    [[], null],
    [[1], 1],
    [[1, 2, 3], 3],
    [[3, 2, 1], 3],
    [[2, 7, 4], 7],
  ])("of %j is %s, whichever order the list is in", (versions, expected) => {
    expect(newestVersion(versions.map(version))).toBe(expected);
  });
});

describe("a version as a select offers it", () => {
  it.each([
    [3, 3, "v3 (newest published)"],
    [2, 3, "v2"],
    [1, null, "v1"],
  ])("v%s beside a newest of %s reads %j", (version, newest, expected) => {
    expect(versionOptionLabel(version, newest)).toBe(expected);
  });
});
