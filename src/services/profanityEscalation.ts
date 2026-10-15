const VIOLATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const ESCALATION_THRESHOLD = 3;
const MAX_TRACKED_USERS = 5000;

interface ViolationHistory {
  timestamps: number[];
  escalatedAt?: number;
  lastSeenAt: number;
}

const histories = new Map<number, ViolationHistory>();

/** Keeps only ephemeral counts and returns true once when a user reaches the threshold. */
export function recordProfanityViolation(userId: number, now = Date.now()): { count: number; shouldEscalate: boolean } {
  for (const [trackedId, history] of histories) {
    if (now - history.lastSeenAt >= VIOLATION_WINDOW_MS) histories.delete(trackedId);
  }

  let history = histories.get(userId);
  if (!history) {
    if (histories.size >= MAX_TRACKED_USERS) {
      const oldestId = histories.keys().next().value as number | undefined;
      if (oldestId !== undefined) histories.delete(oldestId);
    }
    history = { timestamps: [], lastSeenAt: now };
    histories.set(userId, history);
  }

  history.timestamps = history.timestamps.filter((timestamp) => now - timestamp < VIOLATION_WINDOW_MS);
  if (history.escalatedAt !== undefined && now - history.escalatedAt >= VIOLATION_WINDOW_MS) {
    history.escalatedAt = undefined;
  }
  history.timestamps.push(now);
  history.lastSeenAt = now;

  const shouldEscalate = history.timestamps.length >= ESCALATION_THRESHOLD && history.escalatedAt === undefined;
  if (shouldEscalate) history.escalatedAt = now;
  return { count: history.timestamps.length, shouldEscalate };
}

export const PROFANITY_ESCALATION_POLICY = {
  threshold: ESCALATION_THRESHOLD,
  windowMs: VIOLATION_WINDOW_MS,
} as const;
