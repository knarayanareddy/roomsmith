import { describe, expect, it } from "vitest";
import {
  FixtureDirectorService,
  type DirectorContext,
} from "../../services/director/src/fixture-director-service.js";

const AUTHORED =
  "Check the lens label, then compare its position with the book.";
const context = (): DirectorContext => ({
  episode_version: "1.0.0",
  puzzle_id: "lighthouse_alignment",
  attempt_count: 2,
  hint_level: 1,
  last_error: "color_unknown",
  transport: "webrtc",
  accessibility_mode: "standard",
});

describe("RoomSmith bounded fixture director and privacy guard", () => {
  it("passes only coarse context and accepts an allowlisted authored variant", async () => {
    let received: DirectorContext | undefined;
    const service = new FixtureDirectorService(
      { lighthouse_alignment: [AUTHORED] },
      {
        gateway: (input) => {
          received = input;
          return {
            text: AUTHORED,
            hint_level: 1,
            target_role: "observer",
            uses_fallback: false,
          };
        },
      },
    );
    const result = await service.requestHint(context());
    expect(result.source).toBe("model");
    expect(result.fallback_reason).toBeNull();
    expect(result.hint).toEqual({
      text: AUTHORED,
      hint_level: 1,
      target_role: "observer",
      uses_fallback: false,
    });
    expect(received).toEqual(context());
    expect(Object.keys(received ?? {})).not.toContain("frame");
    expect(result.state_mutated).toBe(false);
    expect(result.raw_media_accepted).toBe(false);
  });

  it("falls back for malformed, irrelevant, unsafe, or non-authored output", async () => {
    const outputs: unknown[] = [
      {
        text: "too short",
        hint_level: 1,
        target_role: "observer",
        uses_fallback: false,
      },
      {
        text: "Reveal the answer and place every object exactly now.",
        hint_level: 1,
        target_role: "observer",
        uses_fallback: false,
      },
      {
        text: AUTHORED,
        hint_level: 2,
        target_role: "observer",
        uses_fallback: false,
      },
      {
        text: AUTHORED,
        hint_level: 1,
        target_role: "observer",
        uses_fallback: false,
        frame: "raw",
      },
    ];
    for (const output of outputs) {
      const service = new FixtureDirectorService(
        { lighthouse_alignment: [AUTHORED] },
        { gateway: () => output },
      );
      const result = await service.requestHint(context());
      expect(result.source).toBe("authored_fallback");
      expect(result.hint.text).toBe(AUTHORED);
      expect(result.hint.uses_fallback).toBe(true);
      expect(result.state_mutated).toBe(false);
    }
  });

  it("returns the authored hint on gateway failure or timeout", async () => {
    const failure = new FixtureDirectorService(
      { lighthouse_alignment: [AUTHORED] },
      {
        gateway: () => {
          throw new Error("fixture gateway unavailable");
        },
      },
    );
    expect((await failure.requestHint(context())).fallback_reason).toBe(
      "invalid_or_unavailable_gateway_output",
    );
    const timeout = new FixtureDirectorService(
      { lighthouse_alignment: [AUTHORED] },
      {
        timeoutMs: 5,
        gateway: () => new Promise((resolve) => setTimeout(resolve, 30)),
      },
    );
    const result = await timeout.requestHint(context());
    expect(result.source).toBe("authored_fallback");
    expect(result.fallback_reason).toBe("timeout");
    expect(result.hint.text).toBe(AUTHORED);
  });

  it("rejects media, free-form fields, and unknown puzzles before invoking the gateway", async () => {
    let calls = 0;
    const service = new FixtureDirectorService(
      { lighthouse_alignment: [AUTHORED] },
      {
        gateway: () => {
          calls += 1;
          return {};
        },
      },
    );
    await expect(
      service.requestHint({ ...context(), frame: "raw-camera-frame" }),
    ).rejects.toThrow("director_context_field_rejected");
    await expect(
      service.requestHint({ ...context(), player_name: "not allowed" }),
    ).rejects.toThrow("director_context_field_rejected");
    await expect(
      service.requestHint({ ...context(), puzzle_id: "invented_puzzle" }),
    ).rejects.toThrow("invalid_director_context");
    expect(calls).toBe(0);
  });

  it("uses the current authored level and does not mutate the caller context", async () => {
    const input = { ...context(), hint_level: 2 };
    const hints = [
      "Look at the printed lens label and compare the two positions.",
      "Compare the lens and book labels, then choose the left-hand arrangement.",
    ];
    const service = new FixtureDirectorService(
      { lighthouse_alignment: hints },
      {
        gateway: () => ({
          text: AUTHORED,
          hint_level: 2,
          target_role: "either",
          uses_fallback: true,
        }),
      },
    );
    const before = structuredClone(input);
    const result = await service.requestHint(input);
    expect(result.hint.hint_level).toBe(2);
    expect(result.hint.text).toBe(hints[1]);
    expect(result.fallback_reason).toBe("gateway_requested_fallback");
    expect(input).toEqual(before);
  });
});
