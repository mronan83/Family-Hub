// [NFR-16][D-128] Dates and times as the approved mockups write them (WP-101), for the server and the
// browser alike: "Mon, Oct 12, 2026" and "6:00 pm".

/** "Mon, Oct 12, 2026" for "2026-10-12"; '' for anything that isn't a date. */
export function dateWords(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "6:00 pm" for "18:00" (or "18:00:00"); '' for anything that isn't a time. */
export function timeWords(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  if (!m) return '';
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return '';
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}
