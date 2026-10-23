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

describe("puzzle graph and remote-fallback validation", () => {
  it("accepts the draft graph with three solvable remote fallbacks", () => {
    expect(validatePuzzleGraph(example)).toEqual({ valid: true, errors: [] });
    expect(
      example.nodes.filter((node) => node.type === "physical_puzzle"),
    ).toHaveLength(3);
  });

  it("rejects publication while reviews and hashes are placeholders", () => {
    const result = validatePuzzleGraph(example, { forPublication: true });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("publication_requires_approved_review");
    expect(result.errors).toContain("missing_game_design_reviewer");
    expect(result.errors).toContain("placeholder_graph_hash");
  });

  it("rejects invalid correct option references", () => {
    const invalid = structuredClone(example);
    invalid.nodes.find(
      (node) => node.type === "physical_puzzle",
    )!.fallback!.correct_option_ids = ["option_missing"];
    expect(validatePuzzleGraph(invalid).errors).toContain(
      "invalid_fallback_solution:node_alignment",
    );
  });

  it("rejects duplicate options and missing fallback assets", () => {
    const invalid = structuredClone(example);
    const puzzle = invalid.nodes.find(
      (node) => node.type === "physical_puzzle",
    )!;
    puzzle.fallback!.options[1]!.option_id =
      puzzle.fallback!.options[0]!.option_id;
    puzzle.fallback!.options[0]!.image_asset_id = "asset_missing";
    const result = validatePuzzleGraph(invalid);
    expect(result.errors).toContain("duplicate_fallback_option:node_alignment");
    expect(result.errors).toContain("missing_fallback_asset:node_alignment");
  });

  it("rejects duplicate authored solution identifiers", () => {
    const invalid = structuredClone(example);
    const puzzle = invalid.nodes.find(
      (node) => node.type === "physical_puzzle",
    )!;
    const correct = puzzle.fallback!.correct_option_ids[0]!;
    puzzle.fallback!.correct_option_ids = [correct, correct];
    expect(validatePuzzleGraph(invalid).errors).toContain(
      "duplicate_fallback_solution:node_alignment",
    );
  });

  it("rejects broken graph references, unreachable nodes, and cycles", () => {
    const broken = structuredClone(example);
    broken.nodes[0]!.next = "node_missing";
    expect(validatePuzzleGraph(broken).errors).toContain(
      "missing_node_reference:node_intro",
    );

    const unreachable = structuredClone(example);
    unreachable.start_node_id = "node_end";
    expect(validatePuzzleGraph(unreachable).errors).toContain(
      "unreachable_node:node_intro",
    );

    const cycle = structuredClone(example);
    cycle.nodes[1]!.next = "node_intro";
    expect(validatePuzzleGraph(cycle).errors).toContain(
      "unbounded_graph_cycle",
    );
  });
});
