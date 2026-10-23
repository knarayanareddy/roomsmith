# RoomSmith

**Track:** Fire TV
**Status:** ordered remote-episode, structured-observation-ingress, bounded-director-fallback, and content-compiler foundations validated locally; Fire OS/companion applications not implemented
**Agent entry point:** [`AGENTS.md`](./AGENTS.md)

RoomSmith is a physical-digital escape-room concept. Its deterministic engine, not the companion or a model, owns puzzle completion; remote fallbacks use the same committed state.

## Local foundation

Requirements: Node.js 22, Corepack, `make`, and a Java 17 runtime for the pure Kotlin harness. The pinned npm Kotlin compiler is installed by `make bootstrap`; this is not an Android SDK.

```bash
make setup                 # install and create .env.local from safe examples
make dev                   # structured ingress + three-puzzle remote-state fixtures; no devices/cloud
make lint typecheck
make test-unit test-contract test-security
corepack pnpm validate:content
make build
```

Draft content validation checks graph and fallback semantics only. `--publish` rejects the current draft because hashes and named reviews are placeholders. `make test-security` audits the npm graph. Native integration, E2E, infrastructure, and deployment targets intentionally fail while unavailable.

The director fixture accepts only coarse schema-bounded context and an allowlisted authored hint variant. Malformed, irrelevant, unavailable, or slow injected-gateway output returns the authored fallback without a puzzle-state mutation; media/free-form context fields are rejected before gateway invocation. No Bedrock/shared-gateway client or Polly audio is connected.

## Workspace map

| Path | Purpose |
| --- | --- |
| [`SPEC.md`](./SPEC.md) | Canonical requirements and vertical slices |
| [`schemas/puzzle-graph.schema.json`](./schemas/puzzle-graph.schema.json) | Canonical puzzle/content contract |
| [`packages/puzzle-engine/`](./packages/puzzle-engine/) | Holds, thresholds, ordered remote episodes, stale rejection, hints, atomic fixture-file snapshots, and metadata-only reports |
| [`packages/content-compiler/`](./packages/content-compiler/) | Schema/graph/fallback and publication-preflight checks |
| [`packages/session-contracts/`](./packages/session-contracts/) | Bounded structured observation ingress, replay/media rejection, and fallback signals; no transport |
| [`services/director/`](./services/director/) | Coarse-context validation, allowlisted fixture gateway output, timeout/failure fallback; no Bedrock client |
| [`scripts/walking-observations.ts`](./scripts/walking-observations.ts) | Labeled synthetic observation-ingress and director-fallback walking fixtures |
| [`content/episodes/light-the-last-lighthouse/`](./content/episodes/light-the-last-lighthouse/) | Draft content copy and pending reviews |
| [`scripts/validate-content.ts`](./scripts/validate-content.ts) | Explicit draft/publication-preflight CLI |
| [`tests/`](./tests/) | TypeScript and Kotlin unit/contract/security checks |
| [`docs/`](./docs/) | Setup evidence, boundaries, and validation results |
| [`ui/`](./ui/) | Static design guidance, not a Fire OS UI |

## External blockers

Fire OS and Android SDKs/signing/devices, CameraX/MediaPipe/OpenCV perception, WebRTC/TURN/signaling, AWS director/content services, real assets/signatures, solver completion, playtests, and release evidence remain blocked or unimplemented. The fixture does not render an episode, process a camera frame, or prove physical playability.

Maintain [`SPEC_TRACEABILITY.md`](./SPEC_TRACEABILITY.md) and [`SPEC_DEVIATIONS.md`](./SPEC_DEVIATIONS.md). Never add raw room media to reports, logs, fixtures, or Git.
