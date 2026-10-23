# RoomSmith — Specification Traceability

**Status:** local ordered-remote-episode, structured-observation-ingress, bounded-director-fallback, and atomic fixture-snapshot slices validated; most requirements remain incomplete
**Coverage:** 57 unique requirement and acceptance IDs from [`SPEC.md`](./SPEC.md)
**Evidence warning:** linked evidence is local source/fixture evidence only; no live integration, device, user-study, or release evidence is implied.

This is the working register required by the implementation specification. Requirement summaries aid navigation only; `SPEC.md` remains normative.

## Status rules

- `not_started`: no implementation exists.
- `in_progress`: active implementation exists but is not yet verified.
- `implemented`: code exists; required tests or release evidence remain incomplete.
- `verified`: all required tests and evidence for this row are linked and current.
- `blocked`: an explicit external dependency or decision prevents completion; identify it in `docs/` and evidence.
- `deviation_pending`: a requested change is awaiting explicit approval in [`SPEC_DEVIATIONS.md`](./SPEC_DEVIATIONS.md); a MUST requirement remains incomplete.

Use paths relative to this project root for implementation, tests, and evidence. Do not enter a path until it exists. Do not use fixture/simulated evidence to satisfy a live-integration gate.

## Register

| ID | Requirement or scenario summary | Status | Implementation paths | Test paths | Demo/device evidence |
| --- | --- | --- | --- | --- | --- |
| `FR-RS-001` | Install and run a signed/versioned episode bundle on Fire OS with remote navigation. | `not_started` | — | — | — |
| `FR-RS-002` | Configure player count, object kit, accessibility, adult supervision, and privacy before play. | `not_started` | — | — | — |
| `FR-RS-003` | Pair an Android companion using one-time credentials and encrypted WebRTC DataChannels; cloud-relay fallback is explicit. | `not_started` | — | — | — |
| `FR-RS-004` | Calibrate the printable PlayMat and selected object kit before physical puzzles. | `in_progress` | `packages/session-contracts/src/index.ts` | `tests/unit/observation-ingress.test.ts` | — |
| `FR-RS-005` | Detect only allowlisted objects, colors, spatial relations, zones, and hand gestures on-device. | `in_progress` | `packages/session-contracts/src/index.ts` | `tests/unit/observation-ingress.test.ts` | — |
| `FR-RS-006` | Emit candidate and stable structured observations with confidence, sequence, and calibration state; never emit frames. | `in_progress` | `packages/session-contracts/src/index.ts` | `tests/unit/observation-ingress.test.ts`<br>`docs/validation.md` | — |
| `FR-RS-007` | Evaluate puzzle requirements deterministically on Fire TV using hold-to-verify and temporal hysteresis. | `in_progress` | `packages/puzzle-engine` | `packages/puzzle-engine/src/test` | — |
| `FR-RS-008` | Complete the three authored puzzles and corresponding scene transitions without model participation. | `in_progress` | `packages/puzzle-engine/src/main/kotlin/com/roomsmith/puzzle/RemoteEpisodeSession.kt` | `packages/puzzle-engine/src/test` | — |
| `FR-RS-009` | Provide role-based clues and a complete solo path. | `not_started` | — | — | — |
| `FR-RS-010` | Provide equivalent remote fallbacks, no-timing mode, non-color labels, captions, and reduced motion. | `in_progress` | `packages/puzzle-engine` | `packages/puzzle-engine/src/test` | — |
| `FR-RS-011` | Supply authored hints and optional schema-bounded Bedrock director hints with deterministic fallback. | `in_progress` | `packages/puzzle-engine/src/main/kotlin/com/roomsmith/puzzle/RemoteEpisodeSession.kt`<br>`services/director/src/fixture-director-service.ts` | `packages/puzzle-engine/src/test`<br>`tests/unit/director.test.ts`<br>`docs/validation.md` | — |
| `FR-RS-012` | Recover from disconnect/process restart using committed state and reject stale observations. | `in_progress` | `packages/puzzle-engine/src/main/kotlin/com/roomsmith/puzzle/RemoteEpisodeSession.kt`<br>`packages/puzzle-engine/src/main/kotlin/com/roomsmith/puzzle/RemoteEpisodeFileStore.kt` | `packages/puzzle-engine/src/test`<br>`docs/validation.md` | — |
| `FR-RS-013` | Generate a final illustrated case report from game state only, not room imagery. | `in_progress` | `packages/puzzle-engine` | `packages/puzzle-engine/src/test` | — |
| `FR-RS-014` | Publish only schema-valid, solver-verified, asset-verified, human-reviewed puzzle graphs. | `in_progress` | `packages/content-compiler` | `tests/unit`<br>`tests/security` | — |
| `FR-RS-015` | Delete session artifacts on request and under retention policy. | `not_started` | — | — | — |
| `INT-RS-001` | The complete game MUST run as an installable Fire OS app and be demonstrated on actual Fire TV hardware or the permitted simulator. | `not_started` | — | — | — |
| `INT-RS-002` | CameraX, MediaPipe, and OpenCV processing MUST run locally on the Android companion; no raw frame channel exists in the backend protocol. | `not_started` | — | — | — |
| `INT-RS-003` | WebRTC DataChannels provide encrypted structured observation/control transport; API Gateway WebSocket is signaling and explicit fallback. | `not_started` | — | — | — |
| `INT-RS-004` | Bedrock director output passes the shared model gateway and cannot invoke game state mutations. | `not_started` | — | — | — |
| `INT-RS-005` | S3/CloudFront serves signed content; the content compiler and solver run before publication. | `not_started` | — | — | — |
| `INT-RS-006` | Polly audio is optional for approved director hints; all essential dialogue ships with captions and authored audio/text. | `not_started` | — | — | — |
| `NFR-RS-001` | p95 stable-observation-to-scene latency below 300 ms over WebRTC on the reference LAN and below 700 ms over cloud fallback. | `not_started` | — | — | — |
| `NFR-RS-002` | Scene rendering sustains 30 fps at 1080p; remote response begins within 100 ms. | `not_started` | — | — | — |
| `NFR-RS-003` | Puzzle evaluation below 8 ms and never waits on network/model inference. | `not_started` | — | — | — |
| `NFR-RS-004` | Zero false puzzle accepts in 1,000 scripted negative interactions per release; measured valid-setup first-attempt completion at least 95% before fallback. | `not_started` | — | — | — |
| `NFR-RS-005` | Perception loss produces a recoverable calibration/fallback state within two seconds, never a false success. | `in_progress` | `packages/session-contracts/src/index.ts` | `tests/unit/observation-ingress.test.ts` | — |
| `NFR-RS-006` | Offline remote-only play works after episode download; no raw room media appears in logs, backend storage, analytics, or case reports. | `in_progress` | `packages/puzzle-engine`<br>`services/director/src/fixture-director-service.ts` | `packages/puzzle-engine/src/test`<br>`tests/unit/director.test.ts` | — |
| `SEC-RS-001` | Raw frames, hand landmarks, room images, and continuous audio never leave the companion; protocols reject media fields/tracks. | `in_progress` | `packages/session-contracts/src/index.ts`<br>`services/director/src/fixture-director-service.ts` | `tests/unit/observation-ingress.test.ts`<br>`tests/unit/director.test.ts` | — |
| `SEC-RS-002` | Pairing/signaling/TURN credentials are one-session, short-lived, revocable, and device-bound. | `not_started` | — | — | — |
| `SEC-RS-003` | Companion cannot commit puzzle state; TV validates session, puzzle, calibration, freshness, and hold. | `in_progress` | `packages/puzzle-engine`<br>`packages/session-contracts/src/index.ts` | `packages/puzzle-engine/src/test`<br>`tests/unit/observation-ingress.test.ts` | — |
| `SEC-RS-004` | Signed content and predicate registries prevent malicious bundles or generated solution changes. | `not_started` | — | — | — |
| `SEC-RS-005` | Session snapshots and director context delete after seven days; case reports contain game metadata only. | `not_started` | — | — | — |
| `SEC-RS-006` | No face/emotion/identity/age inference, behavioral advertising, or training on room media. | `not_started` | — | — | — |
| `SEC-RS-007` | SDP/ICE/access tokens are redacted from logs; SDP/ICE endpoints are rate-limited and schema-validated. | `not_started` | — | — | — |
| `SEC-RS-008` | A lost/revoked companion cannot reconnect or receive prior private clues without new adult approval. | `not_started` | — | — | — |
| `AC-RS-001` | Given modified/unsigned content, when launching, then bundle is rejected and previous signed version remains. | `not_started` | — | — | — |
| `AC-RS-002` | Given consumed/expired pairing material, when exchanged, then no companion credential is issued. | `not_started` | — | — | — |
| `AC-RS-003` | Given real companion/TV, when negotiating, then encrypted DataChannels connect without media tracks. | `not_started` | — | — | — |
| `AC-RS-004` | Given direct WebRTC failure, when fallback activates, then cloud relay is labeled and structured game continues. | `not_started` | — | — | — |
| `AC-RS-005` | Given missing mat markers/poor calibration, when observing, then no stable observation becomes eligible. | `not_started` | — | — | — |
| `AC-RS-006` | Given red cup left of book for less than one second, when evaluating, then puzzle remains incomplete. | `verified` | `packages/puzzle-engine` | `packages/puzzle-engine/src/test`<br>`docs/validation.md` | — |
| `AC-RS-007` | Given red cup left of book stably for one second, when evaluating, then exactly one completion/scene transition occurs. | `verified` | `packages/puzzle-engine` | `packages/puzzle-engine/src/test`<br>`docs/validation.md` | — |
| `AC-RS-008` | Given red cup right of book or unknown color, when evaluating, then no success occurs. | `verified` | `packages/puzzle-engine` | `packages/puzzle-engine/src/test`<br>`docs/validation.md` | — |
| `AC-RS-009` | Given an open palm below confidence/hold threshold, when evaluating, then shield remains closed. | `verified` | `packages/puzzle-engine` | `packages/puzzle-engine/src/test`<br>`docs/validation.md` | — |
| `AC-RS-010` | Given valid open palm, when evaluating, then shield puzzle completes once without face processing. | `verified` | `packages/puzzle-engine` | `packages/puzzle-engine/src/test`<br>`docs/validation.md` | — |
| `AC-RS-011` | Given sequence step 2 before step 1, when evaluating, then sequence does not complete and neutral guidance appears. | `in_progress` | `packages/puzzle-engine` | `packages/puzzle-engine/src/test` | — |
| `AC-RS-012` | Given valid ordered steps within 30 seconds, when evaluating, then final puzzle completes once. | `verified` | `packages/puzzle-engine` | `packages/puzzle-engine/src/test`<br>`docs/validation.md` | — |
| `AC-RS-013` | Given no-timing mode, when sequence exceeds 30 seconds, then order still matters but time does not fail the player. | `verified` | `packages/puzzle-engine` | `packages/puzzle-engine/src/test`<br>`docs/validation.md` | — |
| `AC-RS-014` | Given camera loss during hold, when detected, then candidate verification cancels and fallback becomes available. | `in_progress` | `packages/puzzle-engine`<br>`packages/session-contracts/src/index.ts` | `packages/puzzle-engine/src/test`<br>`tests/unit/observation-ingress.test.ts` | — |
| `AC-RS-015` | Given any camera puzzle, when remote fallback is selected, then the same story node can complete accessibly. | `in_progress` | `packages/puzzle-engine`<br>`packages/content-compiler` | `tests/unit`<br>`packages/puzzle-engine/src/test` | — |
| `AC-RS-016` | Given companion-sent `puzzle.complete`, when received, then TV rejects it and logs a security event without raw payload. | `implemented` | `packages/session-contracts/src/index.ts` | `tests/unit/observation-ingress.test.ts`<br>`docs/validation.md` | — |
| `AC-RS-017` | Given duplicate/stale observations, when received, then no duplicate state transition occurs. | `verified` | `packages/puzzle-engine`<br>`packages/session-contracts/src/index.ts` | `packages/puzzle-engine/src/test`<br>`tests/unit/observation-ingress.test.ts`<br>`docs/validation.md` | — |
| `AC-RS-018` | Given process death after a completed puzzle, when resumed, then committed state/scene restores without replaying completion. | `in_progress` | `packages/puzzle-engine/src/main/kotlin/com/roomsmith/puzzle/RemoteEpisodeSession.kt`<br>`packages/puzzle-engine/src/main/kotlin/com/roomsmith/puzzle/RemoteEpisodeFileStore.kt` | `packages/puzzle-engine/src/test`<br>`docs/validation.md` | — |
| `AC-RS-019` | Given Bedrock failure, when hint is requested, then authored hint arrives within budget and puzzle state is unchanged. | `in_progress` | `packages/puzzle-engine/src/main/kotlin/com/roomsmith/puzzle/RemoteEpisodeSession.kt`<br>`services/director/src/fixture-director-service.ts` | `packages/puzzle-engine/src/test`<br>`tests/unit/director.test.ts`<br>`docs/validation.md` | — |
| `AC-RS-020` | Given revoked companion, when reconnecting, then access/private clues are denied until new approval. | `in_progress` | `packages/session-contracts/src/index.ts` | `tests/unit/observation-ingress.test.ts` | — |
| `AC-RS-021` | Given offline mode after content download, when playing remote-only, then all three puzzles and case report complete. | `in_progress` | `packages/puzzle-engine` | `packages/puzzle-engine/src/test` | — |
| `AC-RS-022` | Given actual Fire TV device/simulator, when demo runs, then real companion observations deterministically change the live episode. | `not_started` | — | — | — |
