export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseUTCDate(s: string): Date {
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${s}`);
  return d;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

export function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function buildDateRange(start: Date, end: Date): string[] {
  const days: string[] = [];
  let cur = new Date(start);
  while (cur <= end) {
    days.push(toDateStr(cur));
    cur = addDays(cur, 1);
  }
  return days;
}

export function isoWeek(d: Date): number {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
