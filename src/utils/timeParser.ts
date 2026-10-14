import { env } from '../config/env.config';
import { BotState } from '../bot/state';

export type ParsedTimeResult =
  | { type: 'duration'; durationMinutes: number; targetDate: Date }
  | { type: 'specific_time'; targetDate: Date; description: string; timezone: string }
  | { type: 'status' }
  | { type: 'cancel' }
  | { type: 'ambiguous'; clarification: string }
  | { type: 'invalid'; error: string };

/**
 * Resolves a timezone string into a valid IANA / UTC timezone name.
 */
export function resolveTimezone(tzInput?: string, fallback: string = env.timezone): string {
  if (!tzInput) return fallback;
  const cleaned = tzInput.trim();
  const upper = cleaned.toUpperCase();

  if (upper === 'UTC' || upper === 'GMT' || upper === 'Z') {
    return 'UTC';
  }

  try {
    new Intl.DateTimeFormat(undefined, { timeZone: cleaned });
    return cleaned;
  } catch {
    return fallback;
  }
}

/**
 * Returns date components in the specified IANA/UTC timezone.
 */
export function getDatePartsInTimezone(date: Date, timezone: string) {
  const validTz = resolveTimezone(timezone);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: validTz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const findVal = (type: string) => {
    const p = parts.find((x) => x.type === type);
    return p ? parseInt(p.value, 10) : 0;
  };

  return {
    year: findVal('year'),
    month: findVal('month'),
    day: findVal('day'),
    hour: findVal('hour') === 24 ? 0 : findVal('hour'),
    minute: findVal('minute'),
    second: findVal('second'),
  };
}

/**
 * Creates a UTC Date given calendar values intended for a specific timezone.
 */
export function createDateForTimezone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string
): Date {
  const validTz = resolveTimezone(timezone);
  // Construct a date string in ISO format without Z
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateString = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;

  // Find the exact UTC offset for this timezone at this point in time
  const tempDate = new Date(`${dateString}Z`);
  const localParts = getDatePartsInTimezone(tempDate, validTz);

  const localTimeMs = Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour,
    localParts.minute,
    localParts.second
  );

  const offsetMs = localTimeMs - tempDate.getTime();
  // Adjust back by the offset
  return new Date(tempDate.getTime() - offsetMs);
}

/**
 * Parses natural language input for the /time command.
 * Supports both local time (Asia/Dhaka) and international timezones (UTC, GMT, etc.).
 */
export function parseTimeCommand(input: string, defaultTimezone: string = env.timezone): ParsedTimeResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return {
      type: 'invalid',
      error: 'Please provide a duration or time, e.g.:\n• `/time 2 hours`\n• `/time 30 minutes`\n• `/time 9:00 AM` (Local Asia/Dhaka)\n• `/time 9:00 AM UTC` (International Standard)\n• `/time status`\n• `/time cancel`',
    };
  }

  const lower = trimmed.toLowerCase();

  // 1. Subcommands
  if (lower === 'status') {
    return { type: 'status' };
  }

  if (lower === 'cancel' || lower === 'clear' || lower === 'stop') {
    return { type: 'cancel' };
  }

  // Strip leading "off " or "in " prefix (e.g. "/time off 2 hours" or "/time in 30 minutes")
  const sanitized = lower.replace(/^(off|in|for)\s+/i, '').trim();

  // 2. Ambiguity check: if the admin says "tomorrow morning" or "morning" without specific hours
  if (/^(tomorrow\s+morning|morning|tomorrow\s+evening|evening|tomorrow\s+afternoon|afternoon|later|soon)$/i.test(sanitized)) {
    return {
      type: 'ambiguous',
      clarification:
        `❓ The phrase "${trimmed}" does not specify an exact hour. To prevent scheduling mistakes, please specify the exact time:\n` +
        `• Example: \`/time tomorrow 9:00 AM\`\n` +
        `• Example: \`/time 9:00 AM\` (Local ${defaultTimezone})\n` +
        `• Example: \`/time 3:00 PM UTC\` (International)\n` +
        `• Example: \`/time 2 hours\``,
    };
  }

  // 3. Relative duration match: e.g. "2 minutes", "30 minutes", "2 hours", "1 day", "45s", "1 hour 30 min"
  const durationRegex = /(?:(\d+)\s*(?:d|day|days))?\s*(?:(\d+)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes))?\s*(?:(\d+)\s*(?:s|sec|secs|second|seconds))?/i;
  const match = sanitized.match(durationRegex);

  if (match && (match[1] || match[2] || match[3] || match[4])) {
    const days = parseInt(match[1] || '0', 10);
    const hours = parseInt(match[2] || '0', 10);
    const minutes = parseInt(match[3] || '0', 10);
    const seconds = parseInt(match[4] || '0', 10);

    const totalSeconds = days * 86400 + hours * 3600 + minutes * 60 + seconds;
    if (totalSeconds > 0) {
      const now = Date.now();
      const targetDate = new Date(now + totalSeconds * 1000);
      const durationMinutes = Math.max(1, Math.round(totalSeconds / 60));
      return {
        type: 'duration',
        durationMinutes,
        targetDate,
      };
    }
  }

  // 4. Specific clock time match (with optional international timezone suffix, e.g. UTC, GMT):
  // e.g. "tomorrow 9:00 AM", "9:00 AM", "9:30 PM", "9:00 AM UTC", "14:00 UTC", "09:00", "21:30"
  const clockRegex = /^(?:(tomorrow|today)\s+)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+([a-z_]+(?:\/[a-z_]+)?))?$/i;
  const clockMatch = sanitized.match(clockRegex);

  if (clockMatch) {
    const isTomorrowExplicit = clockMatch[1]?.toLowerCase() === 'tomorrow';
    let hour = parseInt(clockMatch[2], 10);
    const minute = clockMatch[3] ? parseInt(clockMatch[3], 10) : 0;
    const meridiem = clockMatch[4]?.toLowerCase();
    const explicitTz = clockMatch[5] ? resolveTimezone(clockMatch[5], defaultTimezone) : defaultTimezone;

    if (minute < 0 || minute > 59) {
      return { type: 'invalid', error: `Invalid minute "${minute}". Minute must be between 0 and 59.` };
    }

    if (meridiem) {
      if (hour < 1 || hour > 12) {
        return { type: 'invalid', error: `Invalid hour "${hour}" for 12-hour AM/PM format.` };
      }
      if (meridiem === 'pm' && hour < 12) {
        hour += 12;
      } else if (meridiem === 'am' && hour === 12) {
        hour = 0;
      }
    } else {
      if (hour < 0 || hour > 23) {
        return { type: 'invalid', error: `Invalid hour "${hour}". Hour must be between 0 and 23.` };
      }
    }

    const now = new Date();
    const currentTzParts = getDatePartsInTimezone(now, explicitTz);

    let targetYear = currentTzParts.year;
    let targetMonth = currentTzParts.month;
    let targetDay = currentTzParts.day;

    let targetDate = createDateForTimezone(
      targetYear,
      targetMonth,
      targetDay,
      hour,
      minute,
      0,
      explicitTz
    );

    // If "tomorrow" was requested, advance by 1 day
    if (isTomorrowExplicit) {
      targetDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
    } else {
      // If time has already passed today in the target timezone, schedule for tomorrow
      if (targetDate.getTime() <= now.getTime()) {
        targetDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
      }
    }

    const formattedDesc = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (${explicitTz})`;

    return {
      type: 'specific_time',
      targetDate,
      description: formattedDesc,
      timezone: explicitTz,
    };
  }

  return {
    type: 'invalid',
    error: `Could not understand time parameter: "${input}".\n\nExamples:\n• \`/time 2 minutes\`\n• \`/time 30 minutes\`\n• \`/time 2 hours\`\n• \`/time 9:00 AM\` (Local ${defaultTimezone})\n• \`/time 3:00 PM UTC\` (International)\n• \`/time tomorrow 9:00 AM\`\n• \`/time status\`\n• \`/time cancel\``,
  };
}

/**
 * Formats a Date into a human-readable local string in the given timezone with GMT offset.
 */
export function formatDateTimeInTimezone(date: Date, timezone: string): string {
  const validTz = resolveTimezone(timezone);
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: validTz,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);

  let offsetStr = '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: validTz,
      timeZoneName: 'shortOffset',
    }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (tzPart?.value) {
      offsetStr = ` (${tzPart.value})`;
    }
  } catch {
    // ignore
  }

  return `${formatted}${offsetStr}`;
}

/**
 * Formats a Date into International Universal Standard format (UTC and ISO).
 */
export function formatInternationalDateTime(date: Date): string {
  const utcFormatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);

  return `${utcFormatted} UTC (${date.toISOString().replace('.000', '')})`;
}

/**
 * Formats duration between now and target date into a concise string (e.g. "1h 45m 30s").
 */
export function formatRemainingDuration(targetDate: Date): string {
  const diffMs = targetDate.getTime() - Date.now();
  if (diffMs <= 0) {
    return '0s (imminent)';
  }

  const totalSec = Math.floor(diffMs / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);

  return parts.join(' ');
}

/**
 * Generates the confirmation message sent to the admin when a timer is set.
 * Displays both local (Asia/Dhaka) and international (UTC) time.
 */
export function formatTimerConfirmation(state: BotState, timezone: string = env.timezone): string {
  const reactivateDate = state.reactivateAt ? new Date(state.reactivateAt) : null;
  const localTime = reactivateDate ? formatDateTimeInTimezone(reactivateDate, timezone) : 'None';
  const intlTime = reactivateDate ? formatInternationalDateTime(reactivateDate) : 'None';
  const remaining = reactivateDate ? formatRemainingDuration(reactivateDate) : 'N/A';

  return [
    `⏱️ *Celia — Scheduled Reactivation Confirmed*`,
    '',
    `• *Current Status:* ⏸️ Temporarily Disabled`,
    `• *Scheduled (Local):* \`${localTime}\` [${timezone}]`,
    `• *Scheduled (International):* \`${intlTime}\``,
    `• *Remaining Duration:* \`${remaining}\``,
    '',
    `_User-facing AI responses are now paused. The bot will automatically reactivate when the timer completes, or you can resume manually with /on._`,
  ].join('\n');
}

/**
 * Generates the status message for /time status.
 * Displays both local (Asia/Dhaka) and international (UTC) timestamps.
 */
export function formatTimeStatus(state: BotState, timezone: string = env.timezone): string {
  let statusEmoji = '🟢 Active';
  if (state.status === 'temporary_disabled') {
    statusEmoji = '⏸️ Temporarily Disabled';
  } else if (state.status === 'permanently_disabled') {
    statusEmoji = '⛔ Permanently Disabled';
  }

  const lines = [
    `📊 *Celia — Bot Operational Status*`,
    '',
    `• *Status:* ${statusEmoji}`,
  ];

  if (state.disabledAt) {
    const disabledDate = new Date(state.disabledAt);
    lines.push(`• *Disabled Since (Local):* \`${formatDateTimeInTimezone(disabledDate, timezone)}\``);
    lines.push(`• *Disabled Since (Intl/UTC):* \`${formatInternationalDateTime(disabledDate)}\``);
  }

  if (state.reactivateAt) {
    const reactivateDate = new Date(state.reactivateAt);
    lines.push(`• *Scheduled (Local):* \`${formatDateTimeInTimezone(reactivateDate, timezone)}\` [${timezone}]`);
    lines.push(`• *Scheduled (Intl/UTC):* \`${formatInternationalDateTime(reactivateDate)}\``);
    lines.push(`• *Remaining Duration:* \`${formatRemainingDuration(reactivateDate)}\``);
  } else if (state.status === 'temporary_disabled') {
    lines.push(`• *Scheduled Reactivation:* None (Manual /on required)`);
  }

  lines.push(`• *Timezone (Local):* \`${timezone}\``);
  lines.push(`• *Timezone (International):* \`UTC / GMT\``);

  if (state.reason) {
    lines.push(`• *Reason:* ${state.reason}`);
  }

  lines.push('');
  lines.push(`_Commands: \`/off\`, \`/off permanent\`, \`/time <duration>\`, \`/on\`_`);

  return lines.join('\n');
}
