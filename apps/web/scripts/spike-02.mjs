// SPIKE-02 (01 §5.4): reads the published iCloud test calendar (ICS_SPIKE_URL, owner item Y-6) the
// way calendar sync will, and reports what iCloud serves (headers, caching, structure) and how the
// calendar expands with lib/calendar/ics.ts. Writes the calendar with personal details removed, and
// its expansion, to the folder given, for fixtures. Prints no link and no event text: event titles
// in the report are the scrubbed "Event n". Run it from the spike-02 workflow.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ICAL from 'ical.js';
import { expandIcs, icsUrl, scrubIcs } from '../lib/calendar/ics.ts';

const out = process.argv[2] ?? 'spike-02';
if (!process.env.ICS_SPIKE_URL) {
  console.log(
    'ICS_SPIKE_URL is not set: save the published calendar link as that repository secret (Y-6).',
  );
  process.exit(1);
}
const url = icsUrl(process.env.ICS_SPIKE_URL);
const lines = [];
const say = (s = '') => lines.push(s);

async function get(headers = {}) {
  const t0 = performance.now();
  const res = await fetch(url, {
    headers: { 'user-agent': 'FamilyWise calendar sync (SPIKE-02)', ...headers },
  });
  const body = await res.text();
  return { res, body, ms: Math.round(performance.now() - t0) };
}

// Fetching ------------------------------------------------------------------------------------
const first = await get();
const h = (r, k) => r.headers.get(k) ?? '–';
say('## SPIKE-02: the published iCloud calendar');
say();
say('### Fetch');
say();
say('| | |');
say('|---|---|');
say(`| Status | ${first.res.status} |`);
say(
  `| Host served from | \`${new URL(first.res.url).host}\` (redirected: ${first.res.redirected}) |`,
);
say(`| Content-Type | \`${h(first.res, 'content-type')}\` |`);
say(`| Size | ${first.body.length} bytes |`);
say(`| Time | ${first.ms} ms |`);
for (const k of ['etag', 'last-modified', 'cache-control', 'expires', 'age'])
  say(`| ${k} | \`${h(first.res, k)}\` |`);
if (first.res.status !== 200) {
  console.log(lines.join('\n'));
  process.exit(1);
}

const conditional = {};
if (first.res.headers.get('etag')) conditional['if-none-match'] = first.res.headers.get('etag');
if (first.res.headers.get('last-modified'))
  conditional['if-modified-since'] = first.res.headers.get('last-modified');
if (Object.keys(conditional).length) {
  const again = await get(conditional);
  say(
    `| Conditional fetch (${Object.keys(conditional).join(', ')}) | ${again.res.status}, ${again.body.length} bytes, ${again.ms} ms |`,
  );
}
const third = await get();
say(`| Same ETag on a plain refetch | ${h(third.res, 'etag') === h(first.res, 'etag')} |`);
say(`| Same body on a plain refetch | ${third.body === first.body} |`);

// Structure -------------------------------------------------------------------------------------
const cal = new ICAL.Component(ICAL.parse(first.body));
const vevents = cal.getAllSubcomponents('vevent');
const overrides = vevents.filter((v) => v.hasProperty('recurrence-id'));
const masters = vevents.filter((v) => !v.hasProperty('recurrence-id'));
const prop = (c, n) => c.getFirstProperty(n);
const starts = vevents.map((v) => prop(v, 'dtstart'));
const tzids = new Set(starts.map((p) => p?.getParameter('tzid')).filter(Boolean));
const zones = new Set(
  cal.getAllSubcomponents('vtimezone').map((z) => z.getFirstPropertyValue('tzid')),
);
const names = new Set(vevents.flatMap((v) => v.getAllProperties().map((p) => p.name)));
const statuses = vevents.map((v) => v.getFirstPropertyValue('status')).filter(Boolean);
const years = starts.map((p) => String(p?.getFirstValue()).slice(0, 4)).sort();

say();
say('### What iCloud puts in it');
say();
say('| | |');
say('|---|---|');
for (const n of [
  'prodid',
  'version',
  'calscale',
  'method',
  'x-wr-timezone',
  'x-published-ttl',
  'x-apple-calendar-color',
]) {
  say(`| ${n.toUpperCase()} | \`${cal.getFirstPropertyValue(n) ?? '–'}\` |`);
}
say(
  `| VEVENTs | ${vevents.length}: ${masters.length} series or single events, ${overrides.length} overrides (RECURRENCE-ID) |`,
);
say(
  `| Recurring | ${masters.filter((v) => v.hasProperty('rrule')).length}; rules: ${
    masters
      .filter((v) => v.hasProperty('rrule'))
      .map((v) => `\`${v.getFirstPropertyValue('rrule').toString()}\``)
      .join(', ') || '–'
  } |`,
);
say(`| EXDATE values | ${vevents.flatMap((v) => v.getAllProperties('exdate')).length} |`);
say(`| STATUS values | ${statuses.length ? [...new Set(statuses)].join(', ') : 'none'} |`);
say(`| All-day (VALUE=DATE) | ${starts.filter((p) => p?.getFirstValue()?.isDate).length} |`);
say(
  `| Start zones used | ${[...tzids].join(', ') || 'none'}; UTC starts: ${starts.filter((p) => !p?.getFirstValue()?.isDate && p?.getFirstValue()?.zone?.tzid === 'UTC').length}; floating: ${starts.filter((p) => !p?.getFirstValue()?.isDate && !p?.getParameter('tzid') && p?.getFirstValue()?.zone?.tzid !== 'UTC').length} |`,
);
say(
  `| VTIMEZONE blocks | ${[...zones].join(', ') || 'none'} (every zone used is defined: ${[...tzids].every((z) => zones.has(z))}) |`,
);
say(`| Event years | ${years[0] ?? '–'} to ${years.at(-1) ?? '–'} |`);
say(`| Event properties seen | ${[...names].sort().join(', ')} |`);

// Expansion -------------------------------------------------------------------------------------
const timeZone = cal.getFirstPropertyValue('x-wr-timezone') || [...tzids][0] || 'America/Chicago';
const day = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const window = {
  from: day(new Date(today.getTime() - 14 * 864e5)),
  to: day(new Date(today.getTime() + 90 * 864e5)),
  timeZone,
};
const scrubbed = scrubIcs(first.body);
const instances = expandIcs(scrubbed, window);
const local = (iso) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));

say();
say(`### Expanded, ${window.from} to ${window.to} (${timeZone})`);
say();
say('| Event | Starts | Ends | All-day | Moved or edited |');
say('|---|---|---|---|---|');
for (const i of instances) {
  say(
    `| ${i.title} | ${i.allDay ? i.start : local(i.start)} | ${i.allDay ? `${i.end} (exclusive)` : local(i.end)} | ${i.allDay ? 'yes' : ''} | ${i.changed ? 'yes' : ''} |`,
  );
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icloud-test.ics'), scrubbed);
writeFileSync(
  join(out, 'icloud-test.expanded.json'),
  `${JSON.stringify({ window, instances }, null, 2)}\n`,
);
console.log(lines.join('\n'));
