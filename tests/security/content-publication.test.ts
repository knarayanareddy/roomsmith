import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  validatePuzzleGraph,
  type PuzzleDocument,
} from "../../packages/content-compiler/src/index.js";

const example = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../examples/puzzle-graph.example.json", import.meta.url),
    ),
    "utf8",
  ),
) as PuzzleDocument;

describe("content publication trust boundary", () => {
  it("requires accessibility and named human reviews even when status says approved", () => {
    const invalid = structuredClone(example);
    invalid.review.status = "approved";
    invalid.accessibility.remote_fallback = false;
    const result = validatePuzzleGraph(invalid, { forPublication: true });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("publication_requires_accessibility_paths");
    expect(result.errors).toContain("missing_safety_reviewer");
    expect(result.errors).toContain("missing_accessibility_reviewer");
  });
});
