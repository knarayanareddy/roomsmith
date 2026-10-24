import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import {
  computeGraphSha256,
  solvePuzzleGraph,
  validatePuzzleSchema,
  type PuzzleDocument,
} from "../../../packages/content-compiler/src/index.js";

export interface ContentSigningKeyPair {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface SignedEpisodeManifest {
  schema_version: 1;
  episode_id: string;
  content_version: string;
  title: string;
  graph_sha256: string;
  bundle_sha256: string;
  asset_manifest: Array<{
    asset_id: string;
    kind: string;
    uri: string;
    sha256: string;
  }>;
  key_id: string;
  signature: string;
  issued_at: string;
  provenance: "fixture" | "live";
}

export interface SignedEpisodeBundle {
  manifest: SignedEpisodeManifest;
  document: PuzzleDocument;
  authored_hints: Record<string, string[]>;
}

export interface BundleVerificationResult {
  valid: boolean;
  reason_code: string | null;
  errors: string[];
  graph_sha256: string | null;
  bundle_sha256: string | null;
}

export interface BundleInstallResult {
  disposition: "installed" | "rejected";
  reason_code: string | null;
  active_version: string | null;
  previous_version: string | null;
  rolled_back: boolean;
}

export interface BundleLaunchResult {
  status: "launched" | "rolled_back" | "unavailable";
  active_bundle: SignedEpisodeBundle | null;
  reason_code: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function sha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function signableManifestPayload(
  manifest: Omit<SignedEpisodeManifest, "signature">,
): Buffer {
  return Buffer.from(canonicalize(manifest), "utf8");
}

export function createContentSigningKeyPair(
  keyId = "roomsmith-content-key-v1",
): ContentSigningKeyPair {
  if (!keyId.trim()) {
    throw new Error("content_signing_key_id_required");
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    keyId,
    publicKeyPem: publicKey
      .export({ type: "spki", format: "pem" })
      .toString("utf8"),
    privateKeyPem: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString("utf8"),
  };
}

export function buildAndSignEpisodeBundle(input: {
  document: PuzzleDocument;
  authoredHints: Readonly<Record<string, readonly string[]>>;
  signingKey: ContentSigningKeyPair;
  schema?: object;
  issuedAt?: string;
  provenance?: "fixture" | "live";
}): SignedEpisodeBundle {
  const doc = structuredClone(input.document);
  const hints: Record<string, string[]> = {};
  for (const [puzzleId, ladder] of Object.entries(input.authoredHints)) {
    hints[puzzleId] = [...ladder];
  }

  const graphSha256 = computeGraphSha256(doc);
  if (!doc.review.graph_sha256 || new Set(doc.review.graph_sha256).size <= 1) {
    doc.review.graph_sha256 = graphSha256;
  }

  if (input.schema) {
    const schemaCheck = validatePuzzleSchema(input.schema, doc);
    if (!schemaCheck.valid) {
      throw new Error(
        `bundle_schema_invalid:${schemaCheck.errors[0] ?? "unknown"}`,
      );
    }
  }

  const solverReport = solvePuzzleGraph(doc, {
    forPublication: true,
    verifyGraphSha256: true,
    hintLadders: hints,
  });
  if (!solverReport.valid) {
    throw new Error(
      `bundle_solver_rejected:${solverReport.errors[0] ?? "invalid"}`,
    );
  }

  const episodeId = doc.episode_id ?? "";
  const contentVersion = doc.content_version ?? "";
  const title = doc.title ?? "";
  if (!episodeId.trim() || !contentVersion.trim() || !title.trim()) {
    throw new Error("bundle_metadata_incomplete");
  }

  const bundleSha256 = sha256Hex({
    document: doc,
    authored_hints: hints,
  });
  const issuedAt = input.issuedAt ?? "2026-10-23T12:00:00.000Z";
  const provenance = input.provenance ?? "fixture";
  const unsignedManifest: Omit<SignedEpisodeManifest, "signature"> = {
    schema_version: 1,
    episode_id: episodeId,
    content_version: contentVersion,
    title,
    graph_sha256: graphSha256,
    bundle_sha256: bundleSha256,
    asset_manifest: doc.assets.map((asset) => ({
      asset_id: asset.asset_id,
      kind: asset.kind ?? "scene",
      uri: asset.uri ?? "",
      sha256: asset.sha256,
    })),
    key_id: input.signingKey.keyId,
    issued_at: issuedAt,
    provenance,
  };

  const signature = sign(
    null,
    signableManifestPayload(unsignedManifest),
    input.signingKey.privateKeyPem,
  ).toString("base64url");

  return {
    manifest: {
      ...unsignedManifest,
      signature,
    },
    document: doc,
    authored_hints: hints,
  };
}

export function verifySignedEpisodeBundle(
  candidate: unknown,
  trustedPublicKeys: Readonly<Record<string, string>>,
  schema?: object,
): BundleVerificationResult {
  if (!isRecord(candidate)) {
    return {
      valid: false,
      reason_code: "invalid_bundle_envelope",
      errors: ["invalid_bundle_envelope"],
      graph_sha256: null,
      bundle_sha256: null,
    };
  }
  const manifest = candidate.manifest;
  const document = candidate.document;
  const authoredHints = candidate.authored_hints;
  if (!isRecord(manifest) || !isRecord(document) || !isRecord(authoredHints)) {
    return {
      valid: false,
      reason_code: "invalid_bundle_envelope",
      errors: ["invalid_bundle_envelope"],
      graph_sha256: null,
      bundle_sha256: null,
    };
  }
  if (
    manifest.schema_version !== 1 ||
    typeof manifest.episode_id !== "string" ||
    typeof manifest.content_version !== "string" ||
    typeof manifest.title !== "string" ||
    typeof manifest.graph_sha256 !== "string" ||
    typeof manifest.bundle_sha256 !== "string" ||
    !Array.isArray(manifest.asset_manifest) ||
    typeof manifest.key_id !== "string" ||
    typeof manifest.signature !== "string" ||
    !manifest.signature.trim() ||
    typeof manifest.issued_at !== "string" ||
    (manifest.provenance !== "fixture" && manifest.provenance !== "live")
  ) {
    return {
      valid: false,
      reason_code: "unsigned_or_malformed_manifest",
      errors: ["unsigned_or_malformed_manifest"],
      graph_sha256: null,
      bundle_sha256: null,
    };
  }

  const publicKeyPem = trustedPublicKeys[manifest.key_id];
  if (!publicKeyPem) {
    return {
      valid: false,
      reason_code: "untrusted_signing_key",
      errors: ["untrusted_signing_key"],
      graph_sha256: manifest.graph_sha256,
      bundle_sha256: manifest.bundle_sha256,
    };
  }

  const unsignedManifest: Omit<SignedEpisodeManifest, "signature"> = {
    schema_version: 1,
    episode_id: manifest.episode_id,
    content_version: manifest.content_version,
    title: manifest.title,
    graph_sha256: manifest.graph_sha256,
    bundle_sha256: manifest.bundle_sha256,
    asset_manifest:
      manifest.asset_manifest as SignedEpisodeManifest["asset_manifest"],
    key_id: manifest.key_id,
    issued_at: manifest.issued_at,
    provenance: manifest.provenance,
  };

  let signatureValid: boolean;
  try {
    signatureValid = verify(
      null,
      signableManifestPayload(unsignedManifest),
      publicKeyPem,
      Buffer.from(manifest.signature, "base64url"),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return {
      valid: false,
      reason_code: "signature_verification_failed",
      errors: ["signature_verification_failed"],
      graph_sha256: manifest.graph_sha256,
      bundle_sha256: manifest.bundle_sha256,
    };
  }

  const actualBundleSha256 = sha256Hex({
    document,
    authored_hints: authoredHints,
  });
  if (actualBundleSha256 !== manifest.bundle_sha256) {
    return {
      valid: false,
      reason_code: "bundle_digest_mismatch",
      errors: ["bundle_digest_mismatch"],
      graph_sha256: manifest.graph_sha256,
      bundle_sha256: actualBundleSha256,
    };
  }

  if (schema) {
    const schemaCheck = validatePuzzleSchema(schema, document);
    if (!schemaCheck.valid) {
      return {
        valid: false,
        reason_code: "schema_validation_failed",
        errors: schemaCheck.errors,
        graph_sha256: manifest.graph_sha256,
        bundle_sha256: actualBundleSha256,
      };
    }
  }

  const typedDocument = document as unknown as PuzzleDocument;
  const actualGraphSha256 = computeGraphSha256(typedDocument);
  if (
    actualGraphSha256 !== manifest.graph_sha256 ||
    typedDocument.review?.graph_sha256 !== actualGraphSha256
  ) {
    return {
      valid: false,
      reason_code: "graph_digest_mismatch",
      errors: ["graph_digest_mismatch"],
      graph_sha256: actualGraphSha256,
      bundle_sha256: actualBundleSha256,
    };
  }

  const hintLadders: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(authoredHints)) {
    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== "string")
    ) {
      return {
        valid: false,
        reason_code: "invalid_hint_ladder_payload",
        errors: ["invalid_hint_ladder_payload"],
        graph_sha256: actualGraphSha256,
        bundle_sha256: actualBundleSha256,
      };
    }
    hintLadders[key] = value as string[];
  }

  const solverReport = solvePuzzleGraph(typedDocument, {
    forPublication: true,
    verifyGraphSha256: true,
    hintLadders,
  });
  if (!solverReport.valid) {
    return {
      valid: false,
      reason_code: "solver_verification_failed",
      errors: solverReport.errors,
      graph_sha256: actualGraphSha256,
      bundle_sha256: actualBundleSha256,
    };
  }

  return {
    valid: true,
    reason_code: null,
    errors: [],
    graph_sha256: actualGraphSha256,
    bundle_sha256: actualBundleSha256,
  };
}

/**
 * Signed content distribution service for `GET /v1/episodes/{id}/manifest`
 * and bundle publication verification (FR-RS-014, INT-RS-005, SEC-RS-004).
 */
export class SignedContentDistributionService {
  private readonly bundles = new Map<string, SignedEpisodeBundle>();

  constructor(
    private readonly trustedPublicKeys: Readonly<Record<string, string>>,
    private readonly schema?: object,
  ) {
    if (Object.keys(trustedPublicKeys).length === 0) {
      throw new Error("trusted_public_keys_required");
    }
  }

  publishBundle(bundle: unknown): BundleVerificationResult {
    const verification = verifySignedEpisodeBundle(
      bundle,
      this.trustedPublicKeys,
      this.schema,
    );
    if (!verification.valid) {
      return verification;
    }
    const validBundle = structuredClone(bundle as SignedEpisodeBundle);
    this.bundles.set(validBundle.manifest.episode_id, validBundle);
    return verification;
  }

  getManifest(episodeId: string): SignedEpisodeManifest {
    const bundle = this.bundles.get(episodeId);
    if (!bundle) {
      throw new Error("episode_manifest_not_found");
    }
    return structuredClone(bundle.manifest);
  }

  getBundle(episodeId: string): SignedEpisodeBundle {
    const bundle = this.bundles.get(episodeId);
    if (!bundle) {
      throw new Error("episode_bundle_not_found");
    }
    return structuredClone(bundle);
  }
}

/**
 * Fire OS content store verifying signed bundles and preserving two-version
 * rollback when modified or unsigned content is rejected (FR-RS-001, AC-RS-001, SEC-RS-004).
 */
export class FireOsBundleStore {
  private activeBundle: SignedEpisodeBundle | null = null;
  private previousBundle: SignedEpisodeBundle | null = null;

  constructor(
    private readonly trustedPublicKeys: Readonly<Record<string, string>>,
    private readonly schema?: object,
  ) {
    if (Object.keys(trustedPublicKeys).length === 0) {
      throw new Error("trusted_public_keys_required");
    }
  }

  install(candidate: unknown): BundleInstallResult {
    const verification = verifySignedEpisodeBundle(
      candidate,
      this.trustedPublicKeys,
      this.schema,
    );
    if (!verification.valid) {
      return {
        disposition: "rejected",
        reason_code: verification.reason_code ?? "bundle_verification_failed",
        active_version: this.activeBundle?.manifest.content_version ?? null,
        previous_version: this.previousBundle?.manifest.content_version ?? null,
        rolled_back: false,
      };
    }

    const verifiedBundle = structuredClone(candidate as SignedEpisodeBundle);
    if (
      this.activeBundle &&
      this.activeBundle.manifest.content_version !==
        verifiedBundle.manifest.content_version
    ) {
      this.previousBundle = structuredClone(this.activeBundle);
    }
    this.activeBundle = verifiedBundle;

    return {
      disposition: "installed",
      reason_code: null,
      active_version: this.activeBundle.manifest.content_version,
      previous_version: this.previousBundle?.manifest.content_version ?? null,
      rolled_back: false,
    };
  }

  launch(launchCandidate?: unknown): BundleLaunchResult {
    if (launchCandidate !== undefined) {
      const installResult = this.install(launchCandidate);
      if (installResult.disposition === "rejected") {
        return {
          status: this.activeBundle ? "rolled_back" : "unavailable",
          active_bundle: this.activeBundle
            ? structuredClone(this.activeBundle)
            : null,
          reason_code: installResult.reason_code,
        };
      }
    }

    if (!this.activeBundle) {
      return {
        status: "unavailable",
        active_bundle: null,
        reason_code: "no_signed_bundle_installed",
      };
    }

    const activeCheck = verifySignedEpisodeBundle(
      this.activeBundle,
      this.trustedPublicKeys,
      this.schema,
    );
    if (activeCheck.valid) {
      return {
        status: "launched",
        active_bundle: structuredClone(this.activeBundle),
        reason_code: null,
      };
    }

    if (this.previousBundle) {
      const previousCheck = verifySignedEpisodeBundle(
        this.previousBundle,
        this.trustedPublicKeys,
        this.schema,
      );
      if (previousCheck.valid) {
        this.activeBundle = structuredClone(this.previousBundle);
        this.previousBundle = null;
        return {
          status: "rolled_back",
          active_bundle: structuredClone(this.activeBundle),
          reason_code: activeCheck.reason_code,
        };
      }
    }

    this.activeBundle = null;
    return {
      status: "unavailable",
      active_bundle: null,
      reason_code: activeCheck.reason_code,
    };
  }

  rollback(): BundleInstallResult {
    if (!this.previousBundle) {
      return {
        disposition: "rejected",
        reason_code: "no_previous_version_available",
        active_version: this.activeBundle?.manifest.content_version ?? null,
        previous_version: null,
        rolled_back: false,
      };
    }
    this.activeBundle = structuredClone(this.previousBundle);
    this.previousBundle = null;
    return {
      disposition: "installed",
      reason_code: null,
      active_version: this.activeBundle.manifest.content_version,
      previous_version: null,
      rolled_back: true,
    };
  }

  getActiveBundle(): SignedEpisodeBundle | null {
    return this.activeBundle ? structuredClone(this.activeBundle) : null;
  }

  getPreviousBundle(): SignedEpisodeBundle | null {
    return this.previousBundle ? structuredClone(this.previousBundle) : null;
  }
}
