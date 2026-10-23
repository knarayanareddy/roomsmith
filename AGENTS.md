# RoomSmith Agent Instructions

You are the implementation agent for **RoomSmith only**. Your project root is `projects/roomsmith/`.

## Assignment

Build a cooperative Fire OS escape room with local companion perception and deterministic puzzle completion. The primary hackathon track is **Fire TV**.

Current state: canonical specification, schemas/examples, low-fidelity UI contracts, and an initial locally validated domain/content foundation exist. Applications, live integrations, device evidence, user evidence, and most release gates remain incomplete; see `docs/validation.md`.

## Read these files first

1. [`SPEC.md`](./SPEC.md) — normative project requirements and implementation slices.
2. [`./specs/SHARED_ENGINEERING_STANDARD.md`](./specs/SHARED_ENGINEERING_STANDARD.md) — shared release-blocking engineering requirements.
3. [`ui/PRODUCT.md`](./ui/PRODUCT.md), [`ui/DESIGN.md`](./ui/DESIGN.md), and [`ui/WIREFRAMES.md`](./ui/WIREFRAMES.md) — product truth and design behavior.
4. [`schemas/puzzle-graph.schema.json`](./schemas/puzzle-graph.schema.json) and [`examples/puzzle-graph.example.json`](./examples/puzzle-graph.example.json) — canonical contract and explicitly fictional fixture/draft example.
5. [`SPEC_TRACEABILITY.md`](./SPEC_TRACEABILITY.md) and [`SPEC_DEVIATIONS.md`](./SPEC_DEVIATIONS.md) — registers you must maintain.

The research reports at the repository root are context, not authority. Normative precedence is current law/platform/hackathon rules → `SPEC.md` → shared engineering standard → UI/product guidance → research → convenience.

## Ownership and non-negotiable boundaries

- Create implementation code, tests, docs, and evidence only inside `projects/roomsmith/`. Do not modify a sibling project.
- Treat `SPEC.md`, canonical schemas/examples, and UI contracts as controlled inputs. Do not silently change them; record and escalate required changes in `SPEC_DEVIATIONS.md`.
- Shared files under `specs/` and repository indexes are read-only unless the user separately assigns a cross-project change.
- Do not import another project's production code, create a shared production runtime/database, or broaden scope to another hackathon track.
- Preserve every requirement and acceptance ID. Update `SPEC_TRACEABILITY.md` with actual paths and status after each vertical slice.
- Never fabricate credentials, provider responses, device runs, observations, approvals, accessibility results, user research, or outcome evidence.
- Fixtures and sandboxes must remain labeled and must never satisfy a live-integration release gate.
- Never commit secrets, raw private media, credentials, or sensitive evidence. Use `.env.example` with safe names/examples only.

## Project-specific safeguards

- Only the deterministic Fire TV PuzzleEngine may accept solutions or advance puzzle completion.
- Run allowlisted perception locally on Android; no raw room frame, continuous audio, identity, face, or emotion channel exists.
- Keep complete remote, solo, no-timing, captions, reduced-motion, and reconnect/fallback paths.
- Bedrock may select bounded approved narrative/hints only; it cannot create runtime puzzles or mutate solution predicates.
- Meet negative-interaction and valid-setup evaluations before claiming camera reliability.

## External preflight and blockers

Verify the actual current APIs, SDKs, platform rules, and access before relying on them. The following are execution dependencies, not things to simulate silently:

- Fire TV hardware or the permitted simulator and an Android companion test device
- Physical PlayMat/object kit and scripted positive/negative home evaluations
- Signed/versioned, solver-verified, human-reviewed episode content
- WebRTC/signaling and optional AWS content/model services, with offline remote play intact
- Accessibility and player evaluation participants where required

If a dependency is unavailable, implement only independently testable slices, label the corresponding release gate **blocked**, and continue with an honest fallback where the specification permits one.

## Execution sequence

1. Run preflight and record tool/API/model versions, available real integrations, and blockers in `docs/`.
2. Scaffold the repository layout required by `SPEC.md` and the shared standard, including canonical `make` commands, pinned lockfiles, `.gitignore`, and `.env.example`.
3. Add schema/domain contract tests before connecting adapters. Keep deterministic domain logic independent of cloud/model/device calls.
4. Implement the specification's vertical slices in order. Every slice includes tests, accessibility, security/privacy behavior, and traceability updates.
5. Implement the UI from `ui/tokens.json`, component contracts, and documented states. Static wireframes are guidance, not proof of platform behavior.
6. Keep production and fixture adapters behind the specified typed interfaces. Real required Amazon technology must execute in the main product path for release/demo evidence.
7. Generate only reproducible, non-sensitive evidence. Do not mark completion from unit tests or simulated sponsor integrations alone.

## Completion gate

Do not claim build-complete until every P0 scenario and release gate has evidence, all required real integrations/devices have run, security/privacy/accessibility requirements pass, a clean-checkout setup has been independently executed, and the specification rubric scores at least **90/100 with no category below 70%**. Record any unmet item as incomplete or blocked.
