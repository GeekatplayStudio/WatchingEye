import { describe, expect, it } from "vitest";
import {
  initialContinuousListen,
  onWake,
  onWakeRejected,
  onWindowTick,
  shouldPostWakeChunks,
  startContinuous,
  stopContinuous,
} from "./continuous-listen";

describe("continuous-listen", () => {
  it("starts and stops continuous mode", () => {
    const s = startContinuous(initialContinuousListen());
    expect(s).toEqual({
      continuous: true,
      phase: "listening",
      windowUntil: null,
    });
    expect(shouldPostWakeChunks(s, 0)).toBe(true);
    expect(stopContinuous(s).phase).toBe("idle");
  });

  it("on wake opens PTT window and pauses chunk posting", () => {
    const listening = startContinuous(initialContinuousListen());
    const woken = onWake(listening, 1_000, 20_000);
    expect(woken.phase).toBe("ptt_window");
    expect(woken.continuous).toBe(true);
    expect(woken.windowUntil).toBe(21_000);
    expect(shouldPostWakeChunks(woken, 1_500)).toBe(false);
  });

  it("resumes listening after the PTT window when continuous", () => {
    const woken = onWake(startContinuous(initialContinuousListen()), 1_000, 20_000);
    const resumed = onWindowTick(woken, 21_000);
    expect(resumed).toEqual({
      continuous: true,
      phase: "listening",
      windowUntil: null,
    });
    expect(shouldPostWakeChunks(resumed, 21_000)).toBe(true);
  });

  it("rejects soft-fail without inventing a wake", () => {
    const listening = startContinuous(initialContinuousListen());
    const after = onWakeRejected(listening);
    expect(after.phase).toBe("listening");
    expect(after.windowUntil).toBeNull();
  });

  it("oneshot wake (not continuous) ends idle after window", () => {
    const woken = onWake(initialContinuousListen(), 0, 5_000);
    expect(woken.phase).toBe("ptt_window");
    expect(onWindowTick(woken, 5_000).phase).toBe("idle");
  });
});
