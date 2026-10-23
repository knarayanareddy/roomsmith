# RoomSmith — Visual and Component Design

**Direction:** midnight lighthouse
**Tokens:** [tokens.json](./tokens.json)
**Screens:** [WIREFRAMES.md](./WIREFRAMES.md) and [browser wireframes](./wireframe.html)

## 1. Design thesis

RoomSmith should feel like a coherent nautical escape room observed from a lighthouse control room, not a generic game dashboard or AR camera toy. Midnight blue, weathered brass, warm paper clues, and a fixed bottom action rail make the spatial session feel cinematic while verification remains explicit and calm.

The generated dark-mode suggestion is adopted, but its violet gradients and glow-heavy styling are rejected. Light is used to establish a focal point, not to hide text or simulate unreadable neon.

## 2. Fire TV layout

- 1920×1080 reference with 96 px safe inset.
- Top 144 px: room/chapter title, objective, elapsed time (if the room permits), and connection state.
- Center 672 px: illustrated room or authored spatial scene, with interaction targets no smaller than 96×96 px.
- Bottom 192 px: stable action rail with back, clues, puzzle/verification, companion, and pause.
- Clue sheets use a warm paper panel occupying no more than 65% of the screen; the current objective remains available on return.
- Session lobby uses a 7/5 split for room details and pairing; player list stays visible when code/QR changes.

## 3. Mobile companion layout

- Single-column 360–480 px utility UI, not a miniature TV scene.
- Stable state header: connected/reconnecting/offline, current room, and local interaction status.
- Evidence capture has a clear start, optional preview, analysis state, and cancel/manual route. Preview never fills the entire screen behind unreadable overlays.
- One primary action at a time: `Scan symbol`, `Retry capture`, `Type symbol`, or `Place anchor` as appropriate.
- Private draft note has an explicit `Player only` label and separate delete action.

## 4. Typography and color

- Marcellus/Georgia for room titles and clue headings; Source Sans 3/system sans for all controls and body.
- TV body 30 px, minimum secondary 26 px, companion body 16 sp.
- Puzzle values use tabular figures; clue documents are real text, not text baked into artwork.
- Warm off-white on navy; aged brass for focus and primary actions; red only for errors/invalid states.
- Objective and verification copy remain on opaque surfaces, never directly on complex artwork.

## 5. Component contracts

| Component | Anatomy and behavior | Accessibility/content requirement |
| --- | --- | --- |
| `RS-RoomObjective` | Chapter, current objective, optional elapsed time, room progress | Objective can be reread without advancing or revealing solution |
| `RS-PairingCard` | QR, short code, expiry, connected players, regenerate action | Short code accessible in grouped text; regeneration warns about existing players |
| `RS-ClueSheet` | Clue title, readable body, inspect points, collected state, close | Focus returns to the object that opened it; no tiny handwriting font |
| `RS-PuzzlePanel` | Puzzle prompt, inputs, submitted state, hint entry, reset rules | Never says Fire TV failed to recognize a solution; only companion observes |
| `RS-SymbolCandidate` | Ranked candidates, confidence, uncertainty, accept/retry/manual actions | No automatic puzzle attempt on low confidence; candidates have text labels |
| `RS-AnchorGuide` | Marker quality, tracking state, placement confirmation, fallback | Motion tracking is never equated with puzzle verification |
| `RS-HintSheet` | Hint level, exact authored hint, cost/consequence if any, reveal action | Hints do not unexpectedly solve the puzzle or cover controls |
| `RS-PlayerStatus` | Player label, connected role, evidence events, last action | Exposes no private companion notes or raw images |
| `RS-VerificationNotice` | State (`Checking`, `Uncertain`, `Accepted`, `Not recognized`) and next action | Error says what to do; never blames lighting or the player without evidence |
| `RS-CompletionScene` | Authored ending, solved puzzle summary, replay/exit | Completion comes only from PuzzleEngine; no celebration from a model response |

## 6. Verification visual grammar

- `Checking`: static hourglass + elapsed state, no indefinite spinner-only feedback.
- `Uncertain`: question + `Could not verify` + ranked candidates/manual input.
- `Accepted`: check + exact accepted action + resulting deterministic state change.
- `Not recognized`: broken-link icon + what was observed + retry/manual choices.
- `Camera unavailable`: camera-off icon + direct typed-symbol path; the rest of the room remains usable.

No full-screen red flash, shake, or failure sound is used. Verification notices persist until read/dismissed and do not vanish before accessibility services can announce them.

## 7. Illustration, motion, and sound

- Rooms use authored 2D/2.5D nautical dioramas with crisp silhouettes and material texture. Camera imagery never replaces the room.
- Scene transitions 300 ms maximum, focus changes 180 ms, with static alternatives under reduced motion.
- Ambient motion is paused during puzzle entry and clue reading.
- Audio cues have visual equivalents; essential dialogue is captioned. No flashing above accessibility thresholds.

## 8. Required visual states

Session: unpaired, waiting, connected, expired, host offline, recovered. Verification: permission needed, capturing, checking, uncertain, accepted, not recognized, manual, timeout. AR: unsupported, permission denied, searching, aligned, tracking, confirmed, fallback. Puzzle: untouched, draft, invalid, solved, hint used. Every state keeps a deterministic next action.

## 9. Implementation handoff

Leanback focus targets and libGDX scene objects share stable object IDs but not interaction authority. The companion evidence overlay consumes typed evidence results; it cannot dispatch puzzle completion. CSS/HTML wireframes model layout and focus order only and do not claim AR or device behavior.
