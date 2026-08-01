import type { JsonValue } from "@aijob/database";

export type EffectiveActivityState = "active" | "uncertain" | "closed";

export type EffectiveActivityReason =
  | "source_revision_closed"
  | "deadline_elapsed"
  | "absence_closed"
  | "source_or_absence_uncertain"
  | "active";

export interface EffectiveActivityResult {
  state: EffectiveActivityState;
  reason: EffectiveActivityReason;
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const OFFSET_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const daysPerMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximumDay = daysPerMonth[month - 1];
  return year > 0 && maximumDay !== undefined && day >= 1 && day <= maximumDay;
}

export function shanghaiDateKey(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("now must be a valid Date");
  }

  let year = "";
  let month = "";
  let day = "";
  for (const part of SHANGHAI_DATE_FORMATTER.formatToParts(date)) {
    if (part.type === "year") year = part.value;
    if (part.type === "month") month = part.value;
    if (part.type === "day") day = part.value;
  }
  return `${year}-${month}-${day}`;
}

function knownDeadline(deadline: JsonValue | undefined): string | null {
  if (!deadline || typeof deadline !== "object" || Array.isArray(deadline)) return null;
  const value = deadline.value;
  return deadline.state === "known" && typeof value === "string" ? value.trim() : null;
}

function deadlineDateInShanghai(deadline: JsonValue | undefined): string | null {
  const value = knownDeadline(deadline);
  if (!value) return null;

  const dateOnlyMatch = DATE_ONLY_PATTERN.exec(value);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    return isValidCalendarDate(year, month, day) ? value : null;
  }

  const timestampMatch = OFFSET_TIMESTAMP_PATTERN.exec(value);
  if (!timestampMatch) return null;
  const year = Number(timestampMatch[1]);
  const month = Number(timestampMatch[2]);
  const day = Number(timestampMatch[3]);
  const hour = Number(timestampMatch[4]);
  const minute = Number(timestampMatch[5]);
  const second = Number(timestampMatch[6]);
  if (!isValidCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : shanghaiDateKey(timestamp);
}

export function isDeadlineClosed(deadline: JsonValue | undefined, now: Date): boolean {
  const deadlineDate = deadlineDateInShanghai(deadline);
  return deadlineDate !== null && shanghaiDateKey(now) > deadlineDate;
}

export function resolveEffectiveActivity(input: {
  sourceRevisionState: EffectiveActivityState;
  absenceState?: EffectiveActivityState | null;
  deadline?: JsonValue;
  now: Date;
}): EffectiveActivityResult {
  if (input.sourceRevisionState === "closed") {
    return { state: "closed", reason: "source_revision_closed" };
  }
  if (isDeadlineClosed(input.deadline, input.now)) {
    return { state: "closed", reason: "deadline_elapsed" };
  }
  if (input.absenceState === "closed") {
    return { state: "closed", reason: "absence_closed" };
  }
  if (input.sourceRevisionState === "uncertain" || input.absenceState === "uncertain") {
    return { state: "uncertain", reason: "source_or_absence_uncertain" };
  }
  return { state: "active", reason: "active" };
}
