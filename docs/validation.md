# RoomSmith validation record

Recorded 2026-10-23 on the local vertical-slice branch. Evidence covers pure Kotlin/TypeScript source and synthetic observations/selections only.

## Passing checks

| Check | Result |
| --- | --- |
| ESLint + Prettier | Passed |
| TypeScript strict typecheck + Kotlin main/test compilation | Passed |
| TypeScript unit tests | 32/32 passed: 6 graph/fallback, 5 solver/signed-bundle, 5 pairing/signaling/revocation/deletion, 5 perception/calibration, 6 structured-observation-ingress, and 5 director tests |
| Kotlin puzzle-engine tests | 21/21 passed |
| Canonical schema/contract tests | 6/6 passed: 4 schema/drift tests and 2 cross-module content/pairing/signaling/perception/ingress contract tests |
| Content-publication security test | 1/1 passed |
| npm audit, moderate and above | No known vulnerabilities |
| TypeScript build + Kotlin runtime JAR build | Passed |
| Draft content CLI | Valid in `draft-development` mode |
| Fixture walking paths | Structured candidate/stable-proposal/duplicate/invalid/forged-completion ingress, malformed-gateway authored fallback and media-context rejection, plus ordered three-puzzle remote completion, timed remote hold, authored hint, two atomic fixture-file saves/reopens, metadata-only report |
| **Total tests** | **60/60 passed** |

The remote coordinator enforces authored puzzle order and answers, requires the 750 ms shield hold in standard mode, permits single-selection shield completion in no-timing mode, and keeps authored hints separate from puzzle transitions. The case-report type contains episode/version, completion metadata, hint levels, and supplied active time only; it has no room-media fields.

The content compiler and signed-bundle store validate canonical JSON Schema, predicate/object/zone registries, unsafe instruction bans, hint ladder constraints, and full path enumeration across camera/remote, solo/multiplayer, standard/no-timing, and allowed object-kit subsets. Ed25519-signed manifests and bundles are verified before installation, and modified or unsigned bundles are rejected on launch while preserving the previous signed version for rollback.

The pre-play setup, pairing, and signaling services validate player count, required object kit, accessibility settings, adult supervision, and privacy acknowledgement; enforce 5-minute single-use pairing codes with brute-force lockout and idempotency keys; deliver role clues or reveal them on the shared solo path; validate DataChannel-only SDP/ICE payloads (rejecting audio/video media tracks) with rate limiting and redacted logs; issue short-lived structured-data TURN credentials; activate explicit `cloud_relay` fallback when direct WebRTC fails; block revoked companions until new adult approval; and delete session snapshots and director context on request or 7-day retention expiry.

The local companion perception pipeline evaluates 4-marker ArUco PlayMat calibration, classifies allowlisted objects and white-balanced HSV cup colors (`red`, `blue`, `unknown`), computes mat-normalized `left_of` and `inside_zone` predicates, evaluates 21-landmark `open_palm` gestures without face/emotion/identity/age inference, and emits structured 8 KB envelopes without raw frames or landmarks.

The structured observation ingress enforces an 8 KB JSON envelope, session/device/puzzle/calibration/object-kit binding, monotonic sequences, exact-message dedupe, replay-conflict detection, and revocation. It rejects media keys (including camelCase variants) and companion `puzzle.complete`, emits metadata-only security events, and exposes fallback after invalidation. Stable messages remain proposals requiring authoritative TV hold verification; no ingress path commits a puzzle.

The bounded director fixture validates the exact coarse-context field set, current puzzle/level, attempt bounds, transport, accessibility mode, and 5–45-word output shape. Only the authored variant at the requested level is accepted from the injected gateway, conservatively preventing new objects/actions or extra solution reveal. Exceptions, malformed/irrelevant output, gateway-requested fallback, and a delayed gateway all return the authored hint with explicit fallback metadata; media and player/room free-form fields are rejected before the gateway runs. The service owns no puzzle engine and returns `state_mutated: false`. This is not a Bedrock/shared-gateway integration or a measured production latency result.

The value-only snapshot store uses a versioned bounded binary format, SHA-256 integrity checks, atomic replacement, and semantic remote-state validation. Tests prove reopen through a new store/session with retained hints, completions, and active time; unchanged-state byte determinism; rejection of malformed/checksum/trailing/camera-bearing state; and preservation of the prior file after invalid saves. Transient hold starts are deliberately not persisted, and a reopen test proves the full hold duration cannot be bypassed. Walking/test directories are removed.

The publication CLI was run with `--publish` and correctly exited nonzero for missing game-design/safety/accessibility reviews, unapproved state, and placeholder graph/asset hashes.

## Reproduce

```bash
make lint typecheck test-unit test-contract test-security build dev
corepack pnpm validate:content
corepack pnpm validate:content -- --publish   # expected to fail for this draft
```

## Not evidenced

No Kotlin/TypeScript coverage percentage or performance/false-accept campaign is claimed. Atomic fixture-file reopen is not an actual process-death/power-loss test; elapsed active time is fixture input, and the report is not rendered. No encrypted production storage, retention/deletion worker, Fire TV, companion, camera/perception hardware, live WebRTC/TURN, Bedrock/shared model gateway, Polly, durable backend persistence, S3/CloudFront deployment, rendered accessibility path, physical playtest, offline application run, deployment, or release gate was exercised.
