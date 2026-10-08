// User stories: personas, a story map (epic × phase), then every story with its Given/When/Then
// criteria, requirements, the work packages that deliver it, and its rolled-up status.
import { esc, mdInline } from '../lib/md.mjs';
import { STATUS, STATUS_ORDER } from '../lib/model.mjs';
import {
  countBy,
  filterBar,
  icon,
  labelled,
  latestNote,
  stack,
  pill,
  section,
  shell,
  tag,
  tags,
} from '../lib/ui.mjs';

const PHASES = ['P0', 'P1', 'P2', 'P3'];
const PERSONA = { kid: 'Kid', admin: 'Parent', family: 'Family', developer: 'Builder' };

// Bold the Given / when / then keywords so the structure of each criterion reads at a glance.
const gwt = (html) =>
  html
    .replace(/^(Given)\b/, '<b class="kw">$1</b>')
    .replace(/([,;] )(when|then|and then)\b/g, '$1<b class="kw">$2</b>');

function storyRow(m, ctx, s) {
  const reqTrace = s.reqs.length
    ? `<ul class="trace-list">${s.reqs.map((r) => `<li>${tag(ctx, r)}<span class="t">${esc(m.reqs.get(r)?.text || '')}</span></li>`).join('')}</ul>`
    : '<span class="none">none</span>';
  return `<details class="row" id="${s.id.toLowerCase()}" data-item data-f-epic="${s.epic}" data-f-persona="${s.persona}" data-f-pri="${esc(s.priority)}" data-f-phase="${esc(s.phase)}" data-f-status="${s.status}">
<summary><span class="id">${s.id}</span><span class="what"><span class="title">${esc(s.title)}</span><span class="as">${mdInline(s.as, ctx)}</span><span class="facts"><span>${esc(s.priority)} · ${esc(s.phase)}</span><span>${s.criteria.length} acceptance criteria</span><span>${tags(ctx, s.reqs)}</span></span></span><span class="side">${pill(s.status)}${icon('chevron-down', 'i chev')}</span></summary>
<div class="row-body">
<ol class="gwt">${s.criteria.map((c) => `<li>${gwt(mdInline(c, ctx))}</li>`).join('')}</ol>
<dl class="kv"><dt>Requirements</dt><dd>${reqTrace}</dd><dt>Delivered by</dt><dd>${tags(ctx, s.wps)}</dd></dl>
</div></details>`;
}

export function stories(m, ctx) {
  const all = [...m.stories.values()];
  const counts = countBy(all, (s) => s.status);
  const byPersona = countBy(all, (s) => s.persona);
  const byPri = countBy(all, (s) => s.priority);
  const criteria = all.reduce((n, s) => n + s.criteria.length, 0);

  const personaKey = { Kid: 'kid', Admin: 'admin' };
  const personas = `<div class="cards">${m.personas
    .map((p) => {
      const n = byPersona[personaKey[p.id]] || 0;
      return `<div class="card"><p class="eyebrow">${esc(p.id)}</p><h3>${esc(p.name)}</h3><p>${mdInline(p.text, ctx)}</p><p class="small">${
        n
          ? `<button type="button" class="btn" data-set-filter="persona:${personaKey[p.id]}" data-filter-label="As ${esc(PERSONA[personaKey[p.id]])}">${n} stories told as ${esc(PERSONA[personaKey[p.id]].toLowerCase())}</button>`
          : 'Appears in acceptance criteria, not as a story teller.'
      }</p></div>`;
    })
    .join('')}</div>${
    byPersona.family || byPersona.developer
      ? `<p class="sec-note">Also told from the family's view (${byPersona.family || 0}) and the builder's view (${byPersona.developer || 0}). Stories written "as a parent" count with Admin.</p>`
      : ''
  }`;

  // Story map: epic × phase ------------------------------------------------------------
  const map = `<div class="matrix"><table><thead><tr><th>Epic</th>${PHASES.map((p) => `<th>${p}</th>`).join('')}</tr></thead><tbody>${m.epics
    .map((e) => {
      const ss = e.stories.map((id) => m.stories.get(id));
      const done = ss.filter((s) => s.status === 'done').length;
      return `<tr><th scope="row"><a href="#${e.id.toLowerCase()}">${e.id}</a> ${esc(e.title)}<small>${ss.length} stories</small><span class="prog">${stack(
        countBy(ss, (x) => x.status),
        { small: true, legend: false },
      )}<span>${done} of ${ss.length} done</span></span></th>${PHASES.map((p) => {
        const ids = ss.filter((s) => s.phase === p).map((s) => s.id);
        return `<td>${ids.length ? tags(ctx, ids) : '<span class="none">—</span>'}</td>`;
      }).join('')}</tr>`;
    })
    .join('')}</tbody></table></div>`;

  const opts = (vals, f, label = (v) => v) =>
    vals.map((v) => ({ value: v, label: label(v), count: all.filter((s) => s[f] === v).length }));
  const bar = filterBar({
    noun: 'stories',
    placeholder: 'Search stories, criteria, requirement IDs…',
    groups: [
      {
        facet: 'epic',
        label: 'Epic',
        options: opts(
          m.epics.map((e) => e.id),
          'epic',
        ),
      },
      {
        facet: 'persona',
        label: 'Told as',
        options: opts(
          Object.keys(PERSONA).filter((k) => byPersona[k]),
          'persona',
          (k) => PERSONA[k],
        ),
      },
      {
        facet: 'pri',
        label: 'Priority',
        options: opts(
          ['Must', 'Should', 'Could'].filter((k) => byPri[k]),
          'priority',
        ),
      },
      { facet: 'phase', label: 'Phase', options: opts(PHASES, 'phase') },
      {
        facet: 'status',
        label: 'Status',
        options: STATUS_ORDER.filter((s) => counts[s]).map((s) => ({
          value: s,
          label: STATUS[s].label,
          icon: STATUS[s].icon,
          count: counts[s],
        })),
      },
    ],
  });
  const list = m.epics
    .map(
      (e) =>
        `<div class="sub" data-group id="${e.id.toLowerCase()}"><div class="group-h"><h3>${e.id} · ${esc(e.title)}</h3><span class="muted small">${e.stories.length} stories</span></div><div class="rows">${e.stories
          .map((id) => storyRow(m, ctx, m.stories.get(id)))
          .join('\n')}</div></div>`,
    )
    .join('\n');

  const intro = ctx.docNode.md
    .split('\n')
    .filter((l) => l.startsWith('Priority uses'))
    .join(' ');

  const body = [
    section('personas', 'Personas', personas),
    section('story-map', 'Story map', labelled(map), {
      note: 'Every story by epic and phase, tinted by the status of the work packages that deliver it. P1 is built as milestones P1a to P1d.',
    }),
    section(
      'stories',
      'Stories',
      `${bar}<p class="empty" data-empty hidden>No stories match. Clear the filters to see all ${all.length}.</p>${list}`,
      {
        note: `${mdInline(intro, ctx)} Acceptance criteria are the basis for test names: prefix tests with the story or requirement ID, for example <code>[US-304][CHR-04]</code>.`,
        tools:
          '<span class="tools"><button type="button" class="btn" data-expand="stories" aria-pressed="false">Expand all</button></span>',
      },
    ),
  ].join('\n');

  return shell({
    m,
    ctx,
    page: 'stories',
    h1: 'User stories',
    lede: 'What the family, the board and the platform need, written as stories with Given / When / Then acceptance criteria. Each story names the requirements it covers; its status comes from the work packages that build those requirements.',
    stats: [
      { label: 'stories', value: all.length },
      { label: 'acceptance criteria', value: criteria },
      { label: 'epics', value: m.epics.length },
      { label: 'Must', value: byPri.Must || 0 },
      { label: 'in progress', value: counts.progress || 0 },
      { label: 'done', value: counts.done || 0 },
    ],
    latest: latestNote(ctx.docNode),
    toc: [
      { id: 'personas', label: 'Personas' },
      { id: 'story-map', label: 'Story map' },
      {
        id: 'stories',
        label: 'Stories',
        sub: m.epics.map((e) => ({ id: e.id.toLowerCase(), label: `${e.id} ${e.title}` })),
      },
    ],
    body,
  });
}
