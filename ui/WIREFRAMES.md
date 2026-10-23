# RoomSmith — Low-Fidelity Wireframes

Open [wireframe.html](./wireframe.html). TV artboards use a 16:9 composition; companion verification uses a phone artboard. All rooms, codes, players, symbols, and evidence results are fictional. Nothing on the page accesses a camera or runs AR.

## Screen inventory

| Anchor | Screen | Purpose | Primary path |
| --- | --- | --- | --- |
| `#lobby` | Session lobby | Pair companions and understand roles before play | Start room or continue TV-only |
| `#room` | Room exploration | Inspect the lighthouse and open a clue | Focus/inspect an object |
| `#puzzle` | Clue and puzzle | Read a clue and enter a deterministic answer | Submit symbol sequence |
| `#verification` | Companion evidence review | Resolve uncertain symbol recognition safely | Accept candidate, retry, or type |
| `#completion` | Room completion | Show the deterministic result and next action | Continue chapter or exit |

## 1. Session lobby

**Composition:** room title/description, player list, pairing QR/code with expiry, TV-only continuation.

**Fictional content:** `The Last Light`, two players, one companion connected.

**Annotations**

- QR is a nonfunctional wireframe placeholder.
- Companion enhances evidence capture but is not required for deterministic puzzle play.
- Regenerating a code has an explicit effect on waiting players.

**State variants:** no players; waiting; connected; expired code; host offline; max players; TV-only.

## 2. Room exploration

**Composition:** cinematic lighthouse room, current objective, two visible inspect targets, collected-clue status, stable action rail.

**Fictional content:** restore the lighthouse signal; inspect the logbook and brass compass.

**Annotations**

- Exactly one remote target has focus; focus does not rely on glow alone.
- Objective and action labels sit on opaque surfaces.
- The camera/companion status does not obscure the current objective.

**State variants:** unexplored; clue collected; object focused; companion reconnecting; paused; reduced motion; audio described.

## 3. Clue and puzzle

**Composition:** warm paper logbook clue, symbol-sequence input, hint and reset controls, deterministic submit state.

**Fictional content:** enter three lighthouse signal symbols; no answer is printed in the wireframe.

**Annotations**

- Clue text remains real readable text.
- Manual puzzle input is always available even if companion verification is connected.
- A wrong attempt gives a specific next action without revealing the solution.

**State variants:** untouched; partial input; invalid; checking evidence; accepted; hint open; solved; reset confirmation.

## 4. Companion evidence review

**Composition:** capture status, ranked symbol candidates with confidence, uncertainty explanation, accept/retry/type actions.

**Fictional content:** `North star` 0.61 and `Compass rose` 0.42, below automatic-accept threshold; no puzzle attempt submitted.

**Annotations**

- Confidence is visible but never substitutes for human confirmation.
- Rejecting candidates does not count as a failed puzzle attempt.
- Camera-unavailable state leads directly to typed-symbol input.

**State variants:** permission needed; capturing; checking; uncertain; accepted; not recognized; timeout; offline; manual.

## 5. Room completion

**Composition:** authored lighthouse-beam scene, `Signal restored`, solved-puzzle summary, next chapter and exit actions.

**Annotations**

- Only the PuzzleEngine solved state opens this scene.
- Hint use may be summarized without shaming or reducing the ending.
- Reduced-motion mode uses a static beam and immediate text.

**State variants:** chapter complete; room complete; next chapter unavailable; host disconnected after local completion; replay.

## Flow contract

`Lobby/pairing → Explore → Collect clue → Manual input OR companion evidence review → PuzzleEngine validation → Deterministic state change → Completion`

Recognition uncertainty loops back to candidate review/manual entry; it never directly completes a puzzle. Browser artboards are static and do not represent tested Fire TV, camera, ARCore, or multiplayer behavior.
