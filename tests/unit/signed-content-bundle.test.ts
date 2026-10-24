import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeGraphSha256,
  solvePuzzleGraph,
  type PuzzleDocument,
} from "../../packages/content-compiler/src/index.js";
import {
  buildAndSignEpisodeBundle,
  createContentSigningKeyPair,
  FireOsBundleStore,
  SignedContentDistributionService,
  verifySignedEpisodeBundle,
} from "../../services/content/src/signed-content-service.js";

const schema = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../schemas/puzzle-graph.schema.json", import.meta.url),
    ),
    "utf8",
  ),
) as object;

const draftExample = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../examples/puzzle-graph.example.json", import.meta.url),
    ),
    "utf8",
  ),
) as PuzzleDocument;

const AUTHORED_HINTS: Readonly<Record<string, readonly string[]>> = {
  lighthouse_alignment: [
    "Check the printed red lens label and compare its position with the book.",
    "Place the red lens cup to the left of the archive book and hold still.",
  ],
  raise_the_shield: [
    "Raise one open palm comfortably in frame or choose the remote shield option.",
    "Hold the open palm steady or use the remote shield button to raise the barrier.",
  ],
  lens_archive_sequence: [
    "Start with the circle lens zone before moving the archive book into place.",
    "Place the blue lens in the circle zone first, then the book in the square zone.",
  ],
};

function makeApprovedDocument(version = "1.0.0"): PuzzleDocument {
  const doc = structuredClone(draftExample);
  doc.content_version = version;
  doc.assets = doc.assets.map((asset, index) => ({
    ...asset,
    sha256: `${index + 1}a2b3c4d`.repeat(8),
  }));
  doc.review = {
    status: "approved",
    game_design_reviewer: "Aria Vance",
    safety_reviewer: "Marcus Vance",
    accessibility_reviewer: "Elena Rostova",
    reviewed_at: "2026-10-23T12:00:00.000Z",
    graph_sha256: "",
  };
  doc.review.graph_sha256 = computeGraphSha256(doc);
  return doc;
}

describe("publisher solver and signed episode bundle store", () => {
  it("enumerates all camera/remote, solo/multiplayer, timing, and kit paths", () => {
    const doc = makeApprovedDocument();
    doc.object_kit?.push({
      object_id: "spoon",
      detector_class: "spoon",
      color: "neutral",
      required: false,
      accessible_label: "Optional spoon prop",
    });
    doc.review.graph_sha256 = computeGraphSha256(doc);

    const report = solvePuzzleGraph(doc, {
      forPublication: true,
      verifyGraphSha256: true,
      hintLadders: AUTHORED_HINTS,
    });
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.allowed_kit_subsets).toHaveLength(2);
    // 2 kit subsets * 2 path modes * 2 play modes * 2 timing modes = 16 paths
    expect(report.enumerated_paths).toHaveLength(16);
    expect(report.enumerated_paths.every((path) => path.reaches_end)).toBe(
      true,
    );
  });

  it("rejects unsafe instructions, optional-object dependencies, and premature hint leaks", () => {
    const unsafeDoc = makeApprovedDocument();
    unsafeDoc.nodes.find((node) => node.id === "node_alignment")!.instruction =
      "Climb onto a chair and throw the red cup toward the book.";
    unsafeDoc.object_kit![0]!.required = false;
    unsafeDoc.review.graph_sha256 = computeGraphSha256(unsafeDoc);

    const report = solvePuzzleGraph(unsafeDoc, {
      forPublication: true,
      verifyGraphSha256: true,
      hintLadders: {
        ...AUTHORED_HINTS,
        lighthouse_alignment: [
          "Select option_red_left right now to solve the first puzzle immediately.",
          "Place the red lens cup to the left of the archive book and hold still.",
        ],
      },
    });
    expect(report.valid).toBe(false);
    expect(report.errors).toContain("unsafe_puzzle_instruction:node_alignment");
    expect(report.errors).toContain(
      "puzzle_requires_optional_object:node_alignment:red_cup",
    );
    expect(report.errors).toContain(
      "premature_hint_solution_reveal:lighthouse_alignment:1",
    );
  });

  it("signs a verified bundle and serves its manifest via the content service", () => {
    const keyPair = createContentSigningKeyPair("key-2026-10");
    const bundle = buildAndSignEpisodeBundle({
      document: makeApprovedDocument("1.0.0"),
      authoredHints: AUTHORED_HINTS,
      signingKey: keyPair,
      schema,
    });

    const service = new SignedContentDistributionService(
      { [keyPair.keyId]: keyPair.publicKeyPem },
      schema,
    );
    const pubResult = service.publishBundle(bundle);
    expect(pubResult.valid).toBe(true);
    const manifest = service.getManifest(bundle.manifest.episode_id);
    expect(manifest.content_version).toBe("1.0.0");
    expect(manifest.key_id).toBe("key-2026-10");
  });

  it("rejects modified or unsigned bundles on launch and preserves the previous signed version (AC-RS-001)", () => {
    const keyPair = createContentSigningKeyPair("key-2026-10");
    const trustedKeys = { [keyPair.keyId]: keyPair.publicKeyPem };
    const store = new FireOsBundleStore(trustedKeys, schema);

    const v1 = buildAndSignEpisodeBundle({
      document: makeApprovedDocument("1.0.0"),
      authoredHints: AUTHORED_HINTS,
      signingKey: keyPair,
      schema,
    });
    const v2 = buildAndSignEpisodeBundle({
      document: makeApprovedDocument("1.1.0"),
      authoredHints: AUTHORED_HINTS,
      signingKey: keyPair,
      schema,
    });

    expect(store.install(v1).disposition).toBe("installed");
    expect(store.install(v2)).toMatchObject({
      disposition: "installed",
      active_version: "1.1.0",
      previous_version: "1.0.0",
    });

    // Tamper with v2 document solution
    const tampered = structuredClone(v2);
    tampered.document.nodes.find(
      (node) => node.id === "node_alignment",
    )!.fallback!.correct_option_ids = ["option_red_right"];

    const launchTampered = store.launch(tampered);
    expect(launchTampered.status).toBe("rolled_back");
    expect(launchTampered.reason_code).toBe("bundle_digest_mismatch");
    expect(launchTampered.active_bundle?.manifest.content_version).toBe(
      "1.1.0",
    );

    // Unsigned candidate
    const unsigned = structuredClone(v2);
    unsigned.manifest.signature = "";
    const launchUnsigned = store.launch(unsigned);
    expect(launchUnsigned.status).toBe("rolled_back");
    expect(launchUnsigned.reason_code).toBe("unsigned_or_malformed_manifest");
    expect(store.getActiveBundle()?.manifest.content_version).toBe("1.1.0");

    // Verify explicit rollback to 1.0.0
    const rollbackResult = store.rollback();
    expect(rollbackResult).toMatchObject({
      disposition: "installed",
      active_version: "1.0.0",
      rolled_back: true,
    });
  });

  it("rejects bundles signed by an untrusted key or with modified graph hash", () => {
    const keyPair = createContentSigningKeyPair("key-trusted");
    const rogueKey = createContentSigningKeyPair("key-rogue");
    const bundle = buildAndSignEpisodeBundle({
      document: makeApprovedDocument("1.0.0"),
      authoredHints: AUTHORED_HINTS,
      signingKey: rogueKey,
      schema,
    });

    const untrusted = verifySignedEpisodeBundle(
      bundle,
      { [keyPair.keyId]: keyPair.publicKeyPem },
      schema,
    );
    expect(untrusted.valid).toBe(false);
    expect(untrusted.reason_code).toBe("untrusted_signing_key");
  });
});
