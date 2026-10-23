import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  validatePuzzleSchema,
  type PuzzleDocument,
} from "../../packages/content-compiler/src/index.js";

function path(relative: string): string {
  return fileURLToPath(new URL(`../../${relative}`, import.meta.url));
}
function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(path(relative), "utf8")) as T;
}

const schema = readJson<object>("schemas/puzzle-graph.schema.json");
const example = readJson<PuzzleDocument>("examples/puzzle-graph.example.json");

describe("puzzle graph schema contract", () => {
  it("keeps the compiler schema byte-identical to canonical", () => {
    expect(
      readFileSync(
        path("packages/content-compiler/puzzle-graph.schema.json"),
        "utf8",
      ),
    ).toBe(readFileSync(path("schemas/puzzle-graph.schema.json"), "utf8"));
  });

  it("validates the draft and its content copy", () => {
    expect(validatePuzzleSchema(schema, example)).toEqual({
      valid: true,
      errors: [],
    });
    const content = readJson<PuzzleDocument>(
      "content/episodes/light-the-last-lighthouse/episode.json",
    );
    expect(content).toEqual(example);
    expect(validatePuzzleSchema(schema, content).valid).toBe(true);
  });

  it("rejects camera-only accessibility contracts", () => {
    const invalid = structuredClone(example);
    invalid.accessibility.remote_fallback = false;
    expect(validatePuzzleSchema(schema, invalid).valid).toBe(false);
  });

  it("round-trips without changing graph content", () => {
    expect(JSON.parse(JSON.stringify(example)) as unknown).toEqual(example);
  });
});
