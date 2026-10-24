import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export interface PuzzleRequirementSpec {
  observation_type: "object_relation" | "object_presence" | "gesture";
  subject: string;
  predicate: string;
  target?: string;
  normalized_margin?: number;
  minimum_overlap?: number;
  min_confidence: number;
  max_interval_after_previous_ms?: number;
}

export interface PrivateClueDefinition {
  role_id: "navigator" | "keeper" | "observer";
  asset_id: string;
  solo_reveal_after_seconds: number;
}

export interface BranchCaseDefinition {
  variable?:
    | "session.player_count"
    | "session.no_timing_mode"
    | "puzzle.attempt_count";
  operator?: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
  value?: string | number | boolean;
  next: string;
}

export interface PuzzleNode {
  id: string;
  type: "scene" | "physical_puzzle" | "branch" | "end";
  scene_id?: string;
  dialogue_variant_ids?: string[];
  private_clue?: PrivateClueDefinition;
  next?: string;
  default?: string;
  cases?: BranchCaseDefinition[];
  puzzle_id?: string;
  instruction?: string;
  requirement_mode?: "all" | "any" | "sequence";
  requirements?: PuzzleRequirementSpec[];
  hold_ms?: number;
  timeout_seconds?: number | null;
  hint_after_seconds?: number[];
  fallback?: {
    interaction?:
      | "remote_single_choice"
      | "remote_multi_select"
      | "remote_hold";
    prompt?: string;
    options: Array<{
      option_id: string;
      label?: string;
      image_asset_id: string;
    }>;
    correct_option_ids: string[];
  };
  case_report_scene_id?: string;
}

export interface ObjectKitItem {
  object_id: string;
  detector_class: string;
  color: string;
  required: boolean;
  accessible_label: string;
}

export interface ZoneDefinition {
  zone_id: string;
  mat_polygon_id: string;
  accessible_label: string;
}

export interface AssetDefinition {
  asset_id: string;
  kind?: string;
  uri?: string;
  sha256: string;
}

export interface DirectorPolicyDefinition {
  live_hints_allowed: boolean;
  prompt_version: string;
  fallback_hint_set: string;
  max_words_per_hint: number;
}

export interface PuzzleDocument {
  schema_version?: number;
  episode_id?: string;
  content_version?: string;
  title?: string;
  locale?: string;
  players?: { minimum: number; maximum: number; solo_path: boolean };
  age_minimum?: number;
  object_kit?: ObjectKitItem[];
  zones?: ZoneDefinition[];
  start_node_id: string;
  nodes: PuzzleNode[];
  assets: AssetDefinition[];
  accessibility: {
    remote_fallback: boolean;
    no_timing_mode: boolean;
    color_independent_labels: boolean;
    reduced_motion: boolean;
    captions: boolean;
  };
  director_policy?: DirectorPolicyDefinition;
  review: {
    status: "draft" | "approved";
    game_design_reviewer: string;
    safety_reviewer: string;
    accessibility_reviewer: string;
    reviewed_at?: string;
    graph_sha256: string;
  };
}

export interface ContentValidationResult {
  valid: boolean;
  errors: string[];
}

export interface SolvedPath {
  path_mode: "camera" | "remote";
  play_mode: "solo" | "multiplayer";
  timing_mode: "standard" | "no_timing";
  object_kit_ids: string[];
  visited_node_ids: string[];
  completed_puzzle_ids: string[];
  reaches_end: boolean;
}

export interface SolverOptions {
  forPublication?: boolean;
  verifyGraphSha256?: boolean;
  hintLadders?: Readonly<Record<string, readonly string[]>>;
}

export interface SolverReport {
  valid: boolean;
  errors: string[];
  computed_graph_sha256: string;
  enumerated_paths: SolvedPath[];
  allowed_kit_subsets: string[][];
}

const ALLOWLISTED_OBJECTS = new Set([
  "red_cup",
  "blue_cup",
  "book",
  "bottle",
  "spoon",
]);
const ALLOWLISTED_ZONES = new Set(["zone_lens", "zone_archive", "zone_beacon"]);
const ALLOWLISTED_ROLES = new Set(["navigator", "keeper", "observer"]);
const ALLOWLISTED_PREDICATES = new Set([
  "left_of",
  "right_of",
  "above",
  "below",
  "inside_zone",
  "present",
  "open_palm",
  "thumbs_up",
]);
const REQUIRED_EPISODE_PUZZLES = [
  "lighthouse_alignment",
  "raise_the_shield",
  "lens_archive_sequence",
] as const;
const UNSAFE_ACTION_PATTERNS = [
  /\bclimb\b/i,
  /\bjump\b/i,
  /\bthrow\b/i,
  /\brun\b/i,
  /\bstand\s+on\b/i,
  /\bknife\b/i,
  /\bflame\b/i,
  /\bfire\b/i,
  /\bchemical\b/i,
];

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

export function computeGraphSha256(document: PuzzleDocument): string {
  const normalized = structuredClone(document);
  normalized.review = {
    ...normalized.review,
    graph_sha256: "",
  };
  return createHash("sha256")
    .update(canonicalize(normalized), "utf8")
    .digest("hex");
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

function containsUnsafeInstruction(text: string): boolean {
  return UNSAFE_ACTION_PATTERNS.some((pattern) => pattern.test(text));
}

function enumerateKitSubsets(items: readonly ObjectKitItem[]): string[][] {
  const required = items
    .filter((item) => item.required)
    .map((item) => item.object_id);
  const optional = items
    .filter((item) => !item.required)
    .map((item) => item.object_id);
  const subsets: string[][] = [];
  const totalCombinations = 1 << optional.length;
  for (let mask = 0; mask < totalCombinations; mask += 1) {
    const subset = [...required];
    for (let index = 0; index < optional.length; index += 1) {
      const optionalId = optional[index];
      if (optionalId !== undefined && (mask & (1 << index)) !== 0) {
        subset.push(optionalId);
      }
    }
    subsets.push(subset);
  }
  return subsets;
}

export function solvePuzzleGraph(
  document: PuzzleDocument,
  options: SolverOptions = {},
): SolverReport {
  const baseResult = validatePuzzleGraph(document, {
    forPublication: options.forPublication ?? false,
  });
  const errors = new Set<string>(baseResult.errors);
  const computedGraphSha256 = computeGraphSha256(document);

  if (options.forPublication && options.verifyGraphSha256) {
    if (document.review.graph_sha256 !== computedGraphSha256) {
      errors.add("graph_sha256_mismatch");
    }
  }

  const assetIds = new Set(document.assets.map((asset) => asset.asset_id));
  const kitItems = document.object_kit ?? [];
  const kitObjectIds = new Set(kitItems.map((item) => item.object_id));
  const requiredObjectIds = new Set(
    kitItems.filter((item) => item.required).map((item) => item.object_id),
  );
  const zoneIds = new Set((document.zones ?? []).map((zone) => zone.zone_id));

  for (const item of kitItems) {
    if (!ALLOWLISTED_OBJECTS.has(item.object_id)) {
      errors.add(`unregistered_kit_object:${item.object_id}`);
    }
    if (!item.accessible_label.trim()) {
      errors.add(`missing_kit_accessible_label:${item.object_id}`);
    }
  }

  for (const zone of document.zones ?? []) {
    if (!ALLOWLISTED_ZONES.has(zone.zone_id)) {
      errors.add(`unregistered_zone:${zone.zone_id}`);
    }
    if (!zone.accessible_label.trim()) {
      errors.add(`missing_zone_accessible_label:${zone.zone_id}`);
    }
  }

  for (const node of document.nodes) {
    if (node.type === "branch" && !node.default) {
      errors.add(`missing_branch_default:${node.id}`);
    }
    if (node.type === "scene" && node.private_clue) {
      const clue = node.private_clue;
      if (!ALLOWLISTED_ROLES.has(clue.role_id)) {
        errors.add(`invalid_private_clue_role:${node.id}`);
      }
      if (!assetIds.has(clue.asset_id)) {
        errors.add(`missing_private_clue_asset:${node.id}`);
      }
      if (
        !Number.isSafeInteger(clue.solo_reveal_after_seconds) ||
        clue.solo_reveal_after_seconds < 0 ||
        clue.solo_reveal_after_seconds > 120
      ) {
        errors.add(`invalid_solo_reveal_window:${node.id}`);
      }
    }
    if (node.type === "physical_puzzle") {
      if (node.instruction && containsUnsafeInstruction(node.instruction)) {
        errors.add(`unsafe_puzzle_instruction:${node.id}`);
      }
      if (
        node.fallback?.prompt &&
        containsUnsafeInstruction(node.fallback.prompt)
      ) {
        errors.add(`unsafe_fallback_prompt:${node.id}`);
      }
      for (const option of node.fallback?.options ?? []) {
        if (option.label !== undefined && !option.label.trim()) {
          errors.add(
            `missing_fallback_option_label:${node.id}:${option.option_id}`,
          );
        }
      }
      const requirements = node.requirements ?? [];
      if (requirements.length === 0) {
        errors.add(`missing_puzzle_requirements:${node.id}`);
      }
      for (const req of requirements) {
        if (!ALLOWLISTED_PREDICATES.has(req.predicate)) {
          errors.add(`unregistered_predicate:${node.id}:${req.predicate}`);
        }
        if (
          typeof req.min_confidence !== "number" ||
          !Number.isFinite(req.min_confidence) ||
          req.min_confidence < 0.5 ||
          req.min_confidence > 1
        ) {
          errors.add(`invalid_predicate_confidence:${node.id}`);
        }
        if (req.observation_type === "gesture") {
          if (
            req.subject !== "hand" ||
            (req.predicate !== "open_palm" && req.predicate !== "thumbs_up")
          ) {
            errors.add(`invalid_gesture_predicate:${node.id}`);
          }
        } else if (req.observation_type === "object_presence") {
          if (
            !ALLOWLISTED_OBJECTS.has(req.subject) ||
            !kitObjectIds.has(req.subject) ||
            req.predicate !== "present"
          ) {
            errors.add(`invalid_presence_predicate:${node.id}`);
          }
          if (!requiredObjectIds.has(req.subject)) {
            errors.add(
              `puzzle_requires_optional_object:${node.id}:${req.subject}`,
            );
          }
        } else if (req.observation_type === "object_relation") {
          if (
            !ALLOWLISTED_OBJECTS.has(req.subject) ||
            !kitObjectIds.has(req.subject)
          ) {
            errors.add(`unregistered_predicate_subject:${node.id}`);
          }
          if (!requiredObjectIds.has(req.subject)) {
            errors.add(
              `puzzle_requires_optional_object:${node.id}:${req.subject}`,
            );
          }
          if (req.predicate === "inside_zone") {
            if (
              !req.target ||
              !ALLOWLISTED_ZONES.has(req.target) ||
              !zoneIds.has(req.target) ||
              typeof req.minimum_overlap !== "number" ||
              req.minimum_overlap <= 0 ||
              req.minimum_overlap > 1
            ) {
              errors.add(`invalid_zone_predicate:${node.id}`);
            }
          } else if (
            req.predicate === "left_of" ||
            req.predicate === "right_of" ||
            req.predicate === "above" ||
            req.predicate === "below"
          ) {
            if (
              !req.target ||
              req.target === req.subject ||
              !ALLOWLISTED_OBJECTS.has(req.target) ||
              !kitObjectIds.has(req.target) ||
              typeof req.normalized_margin !== "number" ||
              req.normalized_margin < 0 ||
              req.normalized_margin > 0.5
            ) {
              errors.add(`invalid_spatial_predicate:${node.id}`);
            } else if (!requiredObjectIds.has(req.target)) {
              errors.add(
                `puzzle_requires_optional_object:${node.id}:${req.target}`,
              );
            }
          } else {
            errors.add(`invalid_relation_predicate:${node.id}`);
          }
        }
      }
    }
  }

  if (options.hintLadders) {
    const maxWords = document.director_policy?.max_words_per_hint ?? 45;
    for (const node of document.nodes) {
      if (node.type !== "physical_puzzle" || !node.puzzle_id) continue;
      const ladder = options.hintLadders[node.puzzle_id];
      if (!ladder || ladder.length === 0) {
        errors.add(`missing_hint_ladder:${node.puzzle_id}`);
        continue;
      }
      const correctOptionIds = new Set(node.fallback?.correct_option_ids ?? []);
      ladder.forEach((hint, index) => {
        const words = hint.trim().split(/\s+/).filter(Boolean).length;
        if (words < 5 || words > maxWords) {
          errors.add(`invalid_hint_word_count:${node.puzzle_id}:${index + 1}`);
        }
        if (containsUnsafeInstruction(hint)) {
          errors.add(`unsafe_hint_instruction:${node.puzzle_id}:${index + 1}`);
        }
        if (index < ladder.length - 1) {
          for (const optionId of correctOptionIds) {
            if (hint.includes(optionId)) {
              errors.add(
                `premature_hint_solution_reveal:${node.puzzle_id}:${index + 1}`,
              );
            }
          }
        }
      });
    }
  }

  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const allowedKitSubsets =
    kitItems.length > 0 ? enumerateKitSubsets(kitItems) : [[]];
  const enumeratedPaths: SolvedPath[] = [];

  if (
    !errors.has("unbounded_graph_cycle") &&
    byId.has(document.start_node_id)
  ) {
    const pathModes = ["camera", "remote"] as const;
    const playModes = ["solo", "multiplayer"] as const;
    const timingModes = ["standard", "no_timing"] as const;

    for (const kitSubset of allowedKitSubsets) {
      for (const pathMode of pathModes) {
        for (const playMode of playModes) {
          for (const timingMode of timingModes) {
            const visited: string[] = [];
            const completedPuzzles: string[] = [];
            let currentId: string | undefined = document.start_node_id;
            let reachesEnd = false;
            const playerCount = playMode === "solo" ? 1 : 2;
            const noTiming = timingMode === "no_timing";

            while (
              currentId !== undefined &&
              visited.length <= document.nodes.length
            ) {
              visited.push(currentId);
              const node = byId.get(currentId);
              if (!node) break;
              if (node.type === "end") {
                reachesEnd = true;
                break;
              }
              if (node.type === "physical_puzzle") {
                if (node.puzzle_id) completedPuzzles.push(node.puzzle_id);
                currentId = node.next;
              } else if (node.type === "scene") {
                currentId = node.next;
              } else if (node.type === "branch") {
                let matchedNext: string | undefined;
                for (const branchCase of node.cases ?? []) {
                  const actual =
                    branchCase.variable === "session.player_count"
                      ? playerCount
                      : branchCase.variable === "session.no_timing_mode"
                        ? noTiming
                        : 0;
                  const target = branchCase.value;
                  const match =
                    branchCase.operator === "eq"
                      ? actual === target
                      : branchCase.operator === "neq"
                        ? actual !== target
                        : branchCase.operator === "gt" &&
                            typeof actual === "number" &&
                            typeof target === "number"
                          ? actual > target
                          : branchCase.operator === "gte" &&
                              typeof actual === "number" &&
                              typeof target === "number"
                            ? actual >= target
                            : branchCase.operator === "lt" &&
                                typeof actual === "number" &&
                                typeof target === "number"
                              ? actual < target
                              : branchCase.operator === "lte" &&
                                  typeof actual === "number" &&
                                  typeof target === "number"
                                ? actual <= target
                                : false;
                  if (match) {
                    matchedNext = branchCase.next;
                    break;
                  }
                }
                currentId = matchedNext ?? node.default;
              } else {
                currentId = undefined;
              }
            }

            if (!reachesEnd) {
              errors.add(
                `unsolvable_path:${pathMode}:${playMode}:${timingMode}`,
              );
            }
            for (const requiredPuzzle of REQUIRED_EPISODE_PUZZLES) {
              if (!completedPuzzles.includes(requiredPuzzle)) {
                errors.add(`missing_required_puzzle:${requiredPuzzle}`);
              }
            }
            enumeratedPaths.push({
              path_mode: pathMode,
              play_mode: playMode,
              timing_mode: timingMode,
              object_kit_ids: kitSubset,
              visited_node_ids: visited,
              completed_puzzle_ids: completedPuzzles,
              reaches_end: reachesEnd,
            });
          }
        }
      }
    }
  }

  return {
    valid: errors.size === 0,
    errors: [...errors].sort(),
    computed_graph_sha256: computedGraphSha256,
    enumerated_paths: enumeratedPaths,
    allowed_kit_subsets: allowedKitSubsets,
  };
}
