# RoomSmith data inventory

Inventory date: 2026-10-23. All observations and puzzle selections are synthetic.

| Data | Current location | Classification/provenance | Retention and use |
| --- | --- | --- | --- |
| Draft puzzle graph | `examples/`, `content/episodes/light-the-last-lighthouse/` | Authored fictional story/puzzle content; placeholder hashes | Source-controlled graph/fallback tests only |
| Review registry | `content/episodes/light-the-last-lighthouse/reviews.json` | Pending reviews and null reviewers | Publication remains forbidden |
| Observation fixtures | Kotlin tests | Synthetic object/predicate/confidence/timing values | Process lifetime only; no camera source |
| Committed state/case metadata | Kotlin tests, walking object, temporary snapshot files | Synthetic puzzle IDs, remote completion paths, sequences, hint levels, and supplied active time | In-memory values plus checksummed atomic fixture-file reopen; transient holds are not persisted; walking/test directories are removed; no production snapshot or rendered/exported report |
| Schema copy | `packages/content-compiler/` | Non-sensitive content contract | Byte-drift tests |
| Configuration examples | `.env.example` | Safe placeholders | Real environment files are Git-ignored |

## Not present or collected

No room image/frame, hand landmark, face, continuous audio, SDP/ICE, pairing/TURN credential, player identity, private clue, real playtest, or behavioral profile is present. No media track, analytics, prompt log, cloud snapshot, training dataset, or database exists.

The case-report domain type excludes media by construction, but transport/storage/log scanning and illustrated rendering remain unimplemented. Future companion processing must keep raw frames, landmarks, and continuous audio on-device and expose only allowlisted structured observations.

`session-media/` is Git-ignored. Real room imagery, private clues, access tokens, player exports, and credentials must never be committed or used as public fixtures.
