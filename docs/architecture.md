# RoomSmith foundation architecture

## Implemented boundaries

```text
companion-like observation input ──► session/version/freshness checks
                                          │
                                          ▼
                           predicate + confidence/spatial checks
                                          │
                                          ▼
                           hold / ordered-sequence evaluator
                                          │
                                          ▼
                                  committed completion

remote fallback selection ──► authored answer + expected state sequence ──┘

draft puzzle graph ──► schema + references + remote fallback/publication checks
```

- `packages/puzzle-engine/` is pure Kotlin and is the only implemented completion authority. There is no companion `puzzle.complete` handler.
- Camera-like inputs are data fixtures, not camera output. The engine checks session/calibration/object-kit versions, monotonic observation sequence, confidence, predicate/target, margin/overlap, hold time, and authored step order.
- Calibration/occlusion/review states reset eligibility. One missing candidate frame can be tolerated during a hold; repeated loss resets that hold. No-timing mode removes the inter-step deadline, not ordering or holds.
- Remote commits require the authored option set and current expected state sequence. Completed puzzles are idempotent.
- `caseReport()` contains only puzzle ID, path, commit sequence, and optional observation sequence. It contains no room imagery or landmarks.
- `packages/content-compiler/` checks canonical schema, graph references/reachability/cycles, and fallback option/asset/solution references. Full solver and cryptographic publication verification remain absent.

## Deliberately absent

No Fire OS renderer, Android perception, WebRTC/media transport, signaling/TURN, persistence, director, signed bundle loader, illustrated report, or deployment exists. A reconstructed `EngineState` test is not proof of process-death recovery.

## Independence and output limits

RoomSmith shares no production runtime/database with sibling projects. The walking object completes three fictional remote selections and prints metadata only. It does not claim physical detection, offline application completion, accessible rendered play, or a real case report.
