/**
 * Five-field cron matcher (minute hour dom month dow). No external deps.
 */
export class CronError extends Error {}

type FieldMatcher = (value: number) => boolean;

function parseIntStrict(s: string, min: number, max: number, label: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new CronError(`invalid ${label} '${s}' (expected ${min}-${max})`);
  }
  return n;
}

function parseField(part: string, min: number, max: number, label: string): FieldMatcher {
  const p = part.trim();
  if (!p) throw new CronError(`empty ${label} field`);
  if (p === "*") return () => true;

  if (p.startsWith("*/")) {
    const step = parseIntStrict(p.slice(2), 1, max, `${label} step`);
    return (v) => v % step === 0;
  }

  const values = new Set<number>();
  for (const chunk of p.split(",")) {
    const c = chunk.trim();
    if (!c) continue;
    if (c.includes("-")) {
      const [a, b] = c.split("-", 2);
      const lo = parseIntStrict(a!.trim(), min, max, label);
      const hi = parseIntStrict(b!.trim(), min, max, label);
      if (lo > hi) throw new CronError(`invalid ${label} range '${c}'`);
      for (let i = lo; i <= hi; i++) values.add(i);
    } else {
      values.add(parseIntStrict(c, min, max, label));
    }
  }
  if (values.size === 0) throw new CronError(`invalid ${label} field '${part}'`);
  return (v) => values.has(v);
}

export interface ParsedCron {
  expr: string;
  matches(date: Date): boolean;
}

export function parseCronExpression(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronError(`cron expression must have 5 fields, got ${parts.length}: '${expr}'`);
  }
  const [minP, hourP, domP, monP, dowP] = parts as [string, string, string, string, string];
  const minM = parseField(minP, 0, 59, "minute");
  const hourM = parseField(hourP, 0, 23, "hour");
  const domM = parseField(domP, 1, 31, "day-of-month");
  const monM = parseField(monP, 1, 12, "month");
  const dowM = parseField(dowP, 0, 7, "day-of-week");

  const matches = (date: Date): boolean => {
    const dow = date.getDay();
    const dowAlt = dow === 0 ? 7 : dow;
    const dowOk = dowM(dow) || dowM(dowAlt);
    return (
      minM(date.getMinutes()) &&
      hourM(date.getHours()) &&
      domM(date.getDate()) &&
      monM(date.getMonth() + 1) &&
      dowOk
    );
  };

  return { expr: expr.trim(), matches };
}

export function validateCronExpression(expr: string): void {
  parseCronExpression(expr);
}

/** Next matching minute at or after `from` (exclusive of past seconds). */
export function nextCronRun(expr: string, from: Date = new Date()): Date | null {
  const cron = parseCronExpression(expr);
  const start = new Date(from);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit; i++) {
    const probe = new Date(start.getTime() + i * 60_000);
    if (cron.matches(probe)) return probe;
  }
  return null;
}

export function formatCronWhen(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function cronMinuteKey(date: Date): string {
  return formatCronWhen(date);
}
