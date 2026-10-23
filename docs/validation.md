# RoomSmith validation record

Recorded 2026-10-23 on the local vertical-slice branch. Evidence covers pure Kotlin/TypeScript source and synthetic observations/selections only.

## Passing checks

| Check | Result |
| --- | --- |
| ESLint + Prettier | Passed |
| TypeScript strict typecheck + Kotlin main/test compilation | Passed |
| TypeScript unit tests | 17/17 passed: 6 graph/fallback, 6 structured-observation-ingress, and 5 director tests |
| Kotlin puzzle-engine tests | 21/21 passed |
| Canonical schema/contract tests | 4/4 passed; schema copy byte-identical |
| Content-publication security test | 1/1 passed |
| npm audit, moderate and above | No known vulnerabilities |
| TypeScript build + Kotlin runtime JAR build | Passed |
| Draft content CLI | Valid in `draft-development` mode |
| Fixture walking paths | Structured candidate/stable-proposal/duplicate/invalid/forged-completion ingress, malformed-gateway authored fallback and media-context rejection, plus ordered three-puzzle remote completion, timed remote hold, authored hint, two atomic fixture-file saves/reopens, metadata-only report |
| **Total tests** | **43/43 passed** |

The remote coordinator enforces authored puzzle order and answers, requires the 750 ms shield hold in standard mode, permits single-selection shield completion in no-timing mode, and keeps authored hints separate from puzzle transitions. The case-report type contains episode/version, completion metadata, hint levels, and supplied active time only; it has no room-media fields.

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

No Kotlin/TypeScript coverage percentage or performance/false-accept campaign is claimed. Atomic fixture-file reopen is not an actual process-death/power-loss test; elapsed active time is fixture input, and the report is not rendered. No encrypted production storage, retention/deletion worker, Fire TV, companion, camera/perception, WebRTC/TURN, Bedrock/shared model gateway, Polly, durable backend persistence, signed content, full solver, rendered accessibility path, physical playtest, offline application run, deployment, or release gate was exercised.
