/**
 * Pure state machine for ROADMAP V.4 continuous armed listen.
 *
 * Browser opt-in loop only — not production always-on. Wake still goes through
 * `/api/voice/wake`; this helper never invents a detection.
 */

export type ContinuousPhase = "idle" | "listening" | "ptt_window";

export interface ContinuousListenState {
  /** User wants the loop to keep running after PTT windows. */
  continuous: boolean;
  phase: ContinuousPhase;
  /** Epoch ms when the short PTT window ends; null when none. */
  windowUntil: number | null;
}

/** Initial idle state. */
export function initialContinuousListen(): ContinuousListenState {
  return { continuous: false, phase: "idle", windowUntil: null };
}

/**
 * Start opt-in continuous listening.
 *
 * @example
 * ```ts
 * const s = startContinuous(initialContinuousListen());
 * // → { continuous: true, phase: "listening", windowUntil: null }
 * ```
 */
export function startContinuous(state: ContinuousListenState): ContinuousListenState {
  return { ...state, continuous: true, phase: "listening", windowUntil: null };
}

/** Stop listening and clear any PTT window. */
export function stopContinuous(state: ContinuousListenState): ContinuousListenState {
  return { continuous: false, phase: "idle", windowUntil: null };
}

/**
 * Validated wake hit → pause chunks, open PTT window.
 * Does not clear `continuous` (resume after window).
 */
export function onWake(
  state: ContinuousListenState,
  nowMs: number,
  windowMs: number,
): ContinuousListenState {
  if (!state.continuous && state.phase === "idle") {
    return {
      continuous: false,
      phase: "ptt_window",
      windowUntil: nowMs + windowMs,
    };
  }
  return {
    ...state,
    phase: "ptt_window",
    windowUntil: nowMs + windowMs,
  };
}

/**
 * Soft-fail / reject — never invent a wake; stay listening if continuous.
 */
export function onWakeRejected(state: ContinuousListenState): ContinuousListenState {
  if (!state.continuous) return state;
  if (state.phase === "ptt_window") return state;
  return { ...state, phase: "listening" };
}

/**
 * When the PTT window expires: resume listening if still continuous, else idle.
 */
export function onWindowTick(
  state: ContinuousListenState,
  nowMs: number,
): ContinuousListenState {
  if (state.phase !== "ptt_window" || state.windowUntil === null) return state;
  if (nowMs < state.windowUntil) return state;
  if (state.continuous) {
    return { continuous: true, phase: "listening", windowUntil: null };
  }
  return { continuous: false, phase: "idle", windowUntil: null };
}

/** Whether the UI should post mic chunks to `/api/voice/wake`. */
export function shouldPostWakeChunks(
  state: ContinuousListenState,
  nowMs: number,
): boolean {
  if (state.phase === "listening") return true;
  if (state.phase === "ptt_window" && state.windowUntil !== null && nowMs >= state.windowUntil) {
    return state.continuous;
  }
  return false;
}
