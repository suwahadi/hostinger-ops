const DAY = 24 * 60 * 60 * 1000;
const dateTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" });
const count = new Intl.NumberFormat("id-ID");

export const formatDateTime = (date: Date | null, empty = "belum pernah") => (date ? dateTime.format(date) : empty);

export const formatDate = (date: Date | null) => (date ? dateOnly.format(date) : "tidak diketahui");

export const formatCount = (value: number) => count.format(value);

export function daysUntil(date: Date, now = new Date()): number {
  const diff = date.getTime() - now.getTime();
  return diff >= 0 ? Math.floor(diff / DAY) : -Math.floor(-diff / DAY);
}

export function formatRelativeDays(date: Date | null, now = new Date()): string {
  if (!date) return "tidak diketahui";
  const days = daysUntil(date, now);
  if (days === 0) return "hari ini";
  return days > 0 ? `${days} hari lagi` : `lewat ${-days} hari`;
}
