import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export interface PuzzleNode {
  id: string;
  type: "scene" | "physical_puzzle" | "branch" | "end";
  next?: string;
  default?: string;
  cases?: Array<{ next: string }>;
  puzzle_id?: string;
  fallback?: {
    options: Array<{ option_id: string; image_asset_id: string }>;
    correct_option_ids: string[];
  };
}

export interface PuzzleDocument {
  start_node_id: string;
  nodes: PuzzleNode[];
  assets: Array<{ asset_id: string; sha256: string }>;
  accessibility: {
    remote_fallback: boolean;
    no_timing_mode: boolean;
    color_independent_labels: boolean;
    reduced_motion: boolean;
    captions: boolean;
  };
  review: {
    status: "draft" | "approved";
    game_design_reviewer: string;
    safety_reviewer: string;
    accessibility_reviewer: string;
    graph_sha256: string;
  };
}

export interface ContentValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePuzzleSchema(
  schema: object,
  document: unknown,
): ContentValidationResult {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(document);
  return {
    valid,
    errors: valid
      ? []
      : (validate.errors ?? []).map(
          (error) =>
            `${error.instancePath || "/"} ${error.message ?? "invalid"}`,
        ),
  };
}

function outgoingReferences(node: PuzzleNode): string[] {
  return [
    ...(node.next ? [node.next] : []),
    ...(node.default ? [node.default] : []),
    ...(node.cases ?? []).map((branch) => branch.next),
  ];
}

export function validatePuzzleGraph(
  document: PuzzleDocument,
  options: { forPublication: boolean } = { forPublication: false },
): ContentValidationResult {
  const errors = new Set<string>();
  const nodeIds = document.nodes.map((node) => node.id);
  const uniqueIds = new Set(nodeIds);
  if (uniqueIds.size !== nodeIds.length) errors.add("duplicate_node_id");
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  if (!byId.has(document.start_node_id)) errors.add("missing_start_node");
  const assetIds = new Set(document.assets.map((asset) => asset.asset_id));

  for (const node of document.nodes) {
    for (const reference of outgoingReferences(node)) {
      if (!byId.has(reference)) errors.add(`missing_node_reference:${node.id}`);
    }
    if (node.type === "physical_puzzle") {
      const fallback = node.fallback;
      if (!fallback) {
        errors.add(`missing_remote_fallback:${node.id}`);
        continue;
      }
      const optionIds = fallback.options.map((option) => option.option_id);
      if (new Set(optionIds).size !== optionIds.length)
        errors.add(`duplicate_fallback_option:${node.id}`);
      for (const option of fallback.options) {
        if (!assetIds.has(option.image_asset_id))
          errors.add(`missing_fallback_asset:${node.id}`);
      }
      if (
        new Set(fallback.correct_option_ids).size !==
        fallback.correct_option_ids.length
      ) {
        errors.add(`duplicate_fallback_solution:${node.id}`);
      }
      for (const correct of fallback.correct_option_ids) {
        if (!optionIds.includes(correct))
          errors.add(`invalid_fallback_solution:${node.id}`);
      }
    }
  }

  const reachable = new Set<string>();
  const queue = byId.has(document.start_node_id)
    ? [document.start_node_id]
    : [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = byId.get(id);
    if (node) queue.push(...outgoingReferences(node));
  }
  for (const id of uniqueIds) {
    if (!reachable.has(id)) errors.add(`unreachable_node:${id}`);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  function hasCycle(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const node = byId.get(id);
    const cycle = node
      ? outgoingReferences(node).some(
          (next) => byId.has(next) && hasCycle(next),
        )
      : false;
    visiting.delete(id);
    visited.add(id);
    return cycle;
  }
  if (byId.has(document.start_node_id) && hasCycle(document.start_node_id))
    errors.add("unbounded_graph_cycle");

  if (options.forPublication) {
    if (document.review.status !== "approved")
      errors.add("publication_requires_approved_review");
    if (!document.review.game_design_reviewer.trim())
      errors.add("missing_game_design_reviewer");
    if (!document.review.safety_reviewer.trim())
      errors.add("missing_safety_reviewer");
    if (!document.review.accessibility_reviewer.trim())
      errors.add("missing_accessibility_reviewer");
    if (!Object.values(document.accessibility).every(Boolean))
      errors.add("publication_requires_accessibility_paths");
    if (new Set(document.review.graph_sha256).size <= 1)
      errors.add("placeholder_graph_hash");
    for (const asset of document.assets) {
      if (new Set(asset.sha256).size <= 1)
        errors.add(`placeholder_asset_hash:${asset.asset_id}`);
    }
  }
  return { valid: errors.size === 0, errors: [...errors].sort() };
}
