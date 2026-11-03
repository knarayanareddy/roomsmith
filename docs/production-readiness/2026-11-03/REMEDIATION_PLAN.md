# RoomSmith remediation plan

Applies to the [review](REVIEW.md), pinned SHA `7036277be3f81dad1c3dafa3cc29c2ce04cf9807`. All steps and commands below are **future work**, not executed. Keep the prototype private until the owner approves its threat model and release boundary.

## Dependency map and phases

| Phase / exit gate | Tasks and prerequisites |
| --- | --- |
| 0 Baseline: reproducible fixtures and scope recorded | T1; owner supplies isolated environment |
| 1 Confirmed defects: identity and gateway negatives fail before fixes and pass after | T2 after T1; T3 after T1 |
| 2 Security and meaningful automation: transport/privacy controls demonstrated | T4 after T2 and T3 |
| 3 Operations and product: deployment, restoration and usability observed | T5 after T4 and owner decisions; T6 after T1 and target-device access |
| 4 Independent acceptance: evidence reviewed and release approved | T7 after T2–T6 |

## Tasks

### T1 — Baseline and reproduce (RS-01–05)
**Prerequisite:** isolated checkout at the pinned revision, approved test environment; no real player data. **Paths:** observed `package.json`, `.github/workflows/ci.yml`, `services/signaling/src/websocket-signaling-server.ts`.

1. Record tool versions, SHA, environment and historical run IDs; inspect actual workflow logs separately from current runs.
2. In that isolated environment, run the existing lint, typecheck, unit, contract, security and build scripts defined in `package.json`; record exits and unavailable dependencies rather than weakening gates.
3. Build a socket-level reproduction showing whether an uncredentialed TV with a known session ID receives the hello acknowledgement and replaces routing; reproduce the two gateway keys directly and record timeout behavior with a controlled fake provider.

**Output:** baseline and reproducible before-fix results. **Verification:** an independent operator repeats each case against the same SHA; record evidence and discrepancies. **DoD:** [ ] baseline exits recorded; [ ] RS-01 and RS-03 negative cases established; [ ] unknowns explicitly retained.

### T2 — Authenticate TV and bind peers (RS-01)
**Prerequisites:** T1; owner approves issuer, lifecycle and device/session identity. **Path:** observed `services/signaling/src/websocket-signaling-server.ts` and `services/pairing/src/pairing-service.ts`.

1. Define a TV-specific session-bound credential and rotation/revocation semantics; never treat session ID as a secret or reuse a companion token as TV authority.
2. Require verification before assigning a TV peer; define authorized replacement, reauthentication, disconnection and session expiration behavior.
3. Add real WebSocket tests for missing, forged, wrong-session and revoked TV credentials, attempted replacement and valid authorized reconnection; validate routing and reject unauthorized origin as required by the deployment threat model.

**Output:** authenticated protocol and regression tests. **Verification:** deliberately disable TV verification and confirm the unauthorized-peer test fails; restore it and rerun full gates. **DoD:** [ ] no unauthenticated TV acknowledgment; [ ] replacement and revocation enforced; [ ] no secrets in logs.

### T3 — Model boundary and timeout (RS-03, RS-04)
**Prerequisite:** T1. **Paths:** observed `packages/model-gateway/src/index.ts`, `services/director/src/director-service.ts`.

1. Replace fragile key matching with an explicit output contract or correctly normalized policy; include `execute_command`, `puzzle_complete`, nesting and spelling variants.
2. Enforce coarse context at the gateway boundary as well as the director; bind provider adapters to cancellation, bounded concurrency and safe egress. Specify what happens if cancellation is unsupported.
3. Test direct gateway calls and the actual director separately: malformed output, raw media under unexpected keys, injection text, timeout and delayed provider completion must not authorize game state changes or leak prohibited fields.

**Output:** contract, cancellation behavior and boundary tests. **Verification:** mutate the guard and provider abort handling separately; relevant tests must fail, then pass restored. **DoD:** [ ] bypass spellings rejected; [ ] fallback remains deterministic; [ ] provider lifetime and egress observed rather than asserted.

### T4 — Security and automation gate (RS-01–04; preventive)
**Prerequisites:** T2 and T3. **Paths:** observed `.github/workflows/ci.yml`, `tests/contract/`, `tests/security/`; additional test files are proposed.

1. Threat-model browser origins, authentication, replay, message/frame bounds, authorization per role and transport encryption, including adversarial fragmented WebSocket frames.
2. Trace synthetic session and media data through logs, provider requests, storage and deletion; test deny-by-default, retention, revocation and cross-session isolation with synthetic canaries.
3. Pin reviewed CI actions to immutable commits, review lockfile provenance and run the existing security audit; add independent socket/privacy regressions to CI and document unresolved advisories.

**Output:** threat model and enforced security gate. **Verification:** deliberately bypass a role check and insert a synthetic media canary; targeted tests must fail and then pass when restored. **DoD:** [ ] security boundary tests run in CI; [ ] dependencies and action pins reviewed; [ ] privacy deletion evidence recorded.

### T5 — Deployment and recovery (RS-02, RS-05)
**Prerequisites:** T4; owner chooses platform, secret store, retention, RPO/RTO and release authority. **Paths:** observed `docker-compose.yml`, `.github/workflows/pages.yml`; production deployment definition is proposed.

1. Restrict local published ports to loopback or internal networks; use authenticated encrypted services for any shared environment, isolate Redis and remove credentials from logs.
2. Build immutable images with pinned digests, deploy least-privilege services and separate liveness from dependency-aware readiness; establish observability without room media.
3. Define release provenance, backup retention and rollback; exercise an isolated backup restore and deployment rollback with measured recovery times and data integrity.

**Output:** reviewed deployment/runbook and restore report. **Verification:** inspect actual bindings and permissions, test unauthorized access externally, and observe restore/rollback end to end. **DoD:** [ ] no unintended exposed ports; [ ] recovery objectives met or explicitly rejected; [ ] secrets rotated and logs inspected.

### T6 — Device, content and accessibility feasibility (RS-05; preventive)
**Prerequisites:** T1; owner supplies devices, representative participants and approved content. **Paths:** observed `apps/firetv/`, `apps/companion/`, `packages/perception/src/index.ts`, `packages/content-compiler/src/index.ts`.

1. Trace native implementation gaps and create a device integration plan; validate camera and calibration against measured lighting, object and loss scenarios rather than synthetic summaries alone.
2. Complete content solver, real asset hashes and named safety/accessibility reviews; retain draft status until publication preflight passes independently.
3. Test actual remote-only and no-timing play, color-independent labels, captions, focus order and reduced motion with users; document failures and design corrections.

**Output:** device feasibility and accessibility/playtest reports. **Verification:** observe a complete episode on intended devices and repeat camera-loss and remote fallback cases; obtain reviewer sign-off. **DoD:** [ ] real-device evidence attached; [ ] content publication gates satisfied; [ ] accessibility failures resolved or release blocked.

### T7 — Independent acceptance and release (all findings)
**Prerequisites:** T2–T6 complete and owner approval. **Paths:** observed `.github/workflows/ci.yml` and `.github/workflows/pages.yml`; a native release mechanism or workflow and acceptance report are proposed and unverified.

1. Have a reviewer independent of implementers rerun negative controls, release gates and an end-to-end device scenario from the candidate commit.
2. Compare shipped artifacts and running revision with the reviewed commit; inspect access controls, canary leakage, restored data and documented unresolved risks.
3. Obtain explicit release, safety and privacy sign-off; record deployment, rollback trigger, previous known-good artifact and owner contacts.

**Output:** signed acceptance and release record. **Verification:** independently observe deployment and rollback, not just successful commands. **DoD:** [ ] every finding closed or accepted by named owner; [ ] negative controls fail when protections are broken; [ ] deployed revision and recovery verified.

## Production acceptance and change policy

- [ ] Authenticated peers, bounded provider and transport protections proven at real boundaries.
- [ ] Native-device, safety, accessibility and content reviews complete; no demo success represented as product certification.
- [ ] Actual CI, vulnerability review, deployment and restore evidence retained; unrun checks remain open.
- [ ] Owner approves credentials/accounts, cloud spend, user data retention, signing keys, release and any external deployment before use.

Rollback to the previously verified immutable artifact on failed security, data-integrity or device acceptance checks; revoke affected credentials and preserve redacted incident evidence. Do not claim recovery until the restored service and data are observed. No production rollout is authorized by this plan.
