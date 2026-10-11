// Client behavior shared by the pages: search and chip filters, deep links that open and reveal
// their target, contents highlighting, expand/collapse, and hover cards for every linked ID.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LABEL = {
    done: 'Done',
    progress: 'In progress',
    ready: 'Ready',
    queued: 'Queued',
    blocked: 'Blocked',
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = {};
  try {
    index = JSON.parse($('#fw-index')?.textContent || '{}');
  } catch {
    index = {};
  }

  // Filters ------------------------------------------------------------------
  const bar = $('.filters');
  let clearFilters = () => {};
  if (bar) {
    const items = $$('[data-item]');
    const q = $('#q', bar);
    const count = $('#count', bar);
    const reset = $('.reset', bar);
    const temp = $('.temp-filter', bar);
    const active = {};
    const text = new Map(
      items.map((el) => [el, (el.dataset.search || el.textContent).toLowerCase()]),
    );
    const noun = bar.dataset.noun || 'items';

    const apply = () => {
      const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      for (const el of items) {
        let ok = words.every((w) => text.get(el).includes(w));
        for (const [facet, set] of Object.entries(active)) {
          if (!ok || !set.size) continue;
          const vals = (el.getAttribute('data-f-' + facet) || '').split(' ');
          ok = vals.some((v) => set.has(v));
        }
        el.hidden = !ok;
        if (ok) shown++;
      }
      for (const g of $$('[data-group]')) g.hidden = !$$('[data-item]', g).some((el) => !el.hidden);
      for (const e of $$('.empty[data-empty]')) e.hidden = shown > 0;
      count.textContent = `Showing ${shown} of ${items.length} ${noun}`;
      const any = words.length || Object.values(active).some((s) => s.size);
      reset.hidden = !any;
      if (badge) {
        const n = Object.values(active).reduce((sum, s) => sum + s.size, 0);
        badge.textContent = String(n);
        badge.hidden = !n;
      }
    };

    // On small screens the chips fold behind a Filters button.
    const toggle = $('.facet-toggle', bar);
    const badge = toggle && $('.n', toggle);
    toggle?.addEventListener('click', () => {
      const open = !bar.classList.contains('open');
      bar.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });

    bar.addEventListener('click', (e) => {
      const b = e.target.closest('.chip[data-facet]');
      if (!b) return;
      const { facet, value } = b.dataset;
      const set = (active[facet] ||= new Set());
      if (set.has(value)) set.delete(value);
      else set.add(value);
      b.setAttribute('aria-pressed', String(set.has(value)));
      apply();
    });
    q.addEventListener('input', apply);
    clearFilters = () => {
      q.value = '';
      for (const s of Object.values(active)) s.clear();
      for (const b of $$('.chip[data-facet]', bar)) b.setAttribute('aria-pressed', 'false');
      temp.hidden = true;
      temp.textContent = '';
      apply();
    };
    reset.addEventListener('click', clearFilters);

    // Buttons elsewhere on the page can apply a filter, e.g. "Show what Y-2 unblocks".
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-set-filter]');
      if (!b) return;
      clearFilters();
      const [facet, value] = b.dataset.setFilter.split(':');
      active[facet] = new Set([value]);
      const chip = $(`.chip[data-facet="${facet}"][data-value="${value}"]`, bar);
      if (chip) chip.setAttribute('aria-pressed', 'true');
      else {
        temp.hidden = false;
        temp.textContent = b.dataset.filterLabel || value;
      }
      apply();
      const top = bar.getBoundingClientRect().top + scrollY - 8;
      scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
    });

    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName || '';
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag)) {
        e.preventDefault();
        q.focus();
      } else if (e.key === 'Escape' && document.activeElement === q) {
        clearFilters();
      }
    });
    apply();
  }

  // Expand and collapse ---------------------------------------------------------
  for (const btn of $$('[data-expand]')) {
    btn.addEventListener('click', () => {
      const scope = document.getElementById(btn.dataset.expand);
      const open = btn.getAttribute('aria-pressed') !== 'true';
      for (const d of $$('details', scope)) if (!d.closest('[hidden]')) d.open = open;
      btn.setAttribute('aria-pressed', String(open));
      btn.textContent = open ? 'Collapse all' : 'Expand all';
    });
  }

  // Deep links --------------------------------------------------------------------
  const reveal = (id, smooth) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.closest('[hidden]')) clearFilters();
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
    if (el.tagName === 'DETAILS') el.open = true;
    // Land below the sticky filter bar when the target sits in the filtered section.
    const sticky =
      bar && getComputedStyle(bar).position === 'sticky' && bar.closest('section')?.contains(el);
    const offset = sticky ? bar.offsetHeight + 12 : 16;
    const top = el.getBoundingClientRect().top + scrollY - offset;
    scrollTo({ top, behavior: smooth && !reduced ? 'smooth' : 'auto' });
    // Flash the part that names the target: a row's summary or a section's heading, not a whole section.
    const target = el.matches('details')
      ? el.querySelector('summary') || el
      : el.matches('section')
        ? el.querySelector('.sec-head') || el
        : el;
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented) return;
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    if (!id || !document.getElementById(id)) return;
    e.preventDefault();
    try {
      history.replaceState(null, '', '#' + id);
    } catch {
      /* the frame may refuse history changes */
    }
    reveal(id, true);
  });
  window.addEventListener('hashchange', () =>
    reveal(decodeURIComponent(location.hash.slice(1)), true),
  );
  if (location.hash.length > 1) {
    const go = () => reveal(decodeURIComponent(location.hash.slice(1)), false);
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go);
  }

  // Contents highlighting ------------------------------------------------------------
  const links = $$('.toc a[href^="#"]');
  const targets = links
    .map((a) => document.getElementById(a.getAttribute('href').slice(1)))
    .filter(Boolean);
  if ('IntersectionObserver' in window && targets.length) {
    const seen = new Map();
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) seen.set(en.target.id, en.isIntersecting);
        const current = targets.find((t) => seen.get(t.id));
        if (!current) return;
        for (const a of links)
          a.setAttribute('aria-current', String(a.getAttribute('href') === '#' + current.id));
      },
      { rootMargin: '0px 0px -70% 0px' },
    );
    targets.forEach((t) => io.observe(t));
  }

  // Diagrams -------------------------------------------------------------------
  // The viewer renders each <pre class="mermaid"> into an SVG. Wide diagrams get a toggle between
  // fitting the screen and their actual size (scrolling sideways); tiny-when-fitted ones start actual.
  const natural = (svg) =>
    parseFloat(svg.style.maxWidth) ||
    svg.viewBox?.baseVal?.width ||
    svg.getBoundingClientRect().width;
  const setSize = (fig, svg, actual) => {
    fig.classList.toggle('actual', actual);
    svg.style.width = actual ? natural(svg) + 'px' : '';
    const btn = fig.querySelector('.diagram-tools button');
    if (btn) {
      btn.textContent = actual ? 'Fit to width' : 'Actual size';
      btn.setAttribute('aria-pressed', String(actual));
    }
  };
  const fitDiagram = (fig) => {
    const svg = fig.querySelector('svg');
    if (!svg) return;
    const width = natural(svg);
    const room = fig.clientWidth - 32;
    let tools = fig.querySelector('.diagram-tools');
    if (width <= room + 8) {
      tools?.remove();
      setSize(fig, svg, false);
      return;
    }
    if (!tools) {
      tools = document.createElement('div');
      tools.className = 'diagram-tools';
      const note = document.createElement('span');
      note.textContent = 'Wider than the screen.';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.addEventListener('click', () => setSize(fig, svg, !fig.classList.contains('actual')));
      tools.append(note, btn);
      fig.prepend(tools);
      setSize(fig, svg, room / width < 0.55);
    }
  };
  const figures = $$('.diagram');
  if (figures.length && 'MutationObserver' in window) {
    const mo = new MutationObserver((list) => {
      for (const rec of list) {
        const fig = rec.target.closest?.('.diagram');
        if (fig && fig.querySelector('svg')) fitDiagram(fig);
      }
    });
    for (const fig of figures) {
      mo.observe(fig, { childList: true, subtree: true });
      fitDiagram(fig);
    }
    if ('ResizeObserver' in window) {
      let last = innerWidth;
      new ResizeObserver(() => {
        if (Math.abs(innerWidth - last) < 40) return;
        last = innerWidth;
        for (const fig of figures) {
          fig.querySelector('.diagram-tools')?.remove();
          fitDiagram(fig);
        }
      }).observe(document.documentElement);
    }
  }

  // Hover cards for IDs ------------------------------------------------------------
  const pop = document.createElement('div');
  pop.className = 'pop';
  pop.hidden = true;
  pop.setAttribute('role', 'tooltip');
  pop.id = 'fw-pop';
  document.body.append(pop);
  let timer = 0;
  const show = (a) => {
    const entry = index[a.dataset.id];
    if (!entry) return;
    const [title, status, kind] = entry;
    pop.replaceChildren();
    const head = document.createElement('div');
    head.className = 'pop-h';
    const id = document.createElement('span');
    id.className = 'id';
    id.textContent = a.dataset.id;
    head.append(id);
    if (status) {
      const p = document.createElement('span');
      p.className = `pill st-${status}`;
      p.textContent = LABEL[status] || status;
      head.append(p);
    }
    const k = document.createElement('span');
    k.className = 'pop-k';
    k.textContent = kind;
    head.append(k);
    const body = document.createElement('div');
    body.textContent = title;
    pop.append(head, body);
    pop.hidden = false;
    const r = a.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    const top = r.bottom + h + 12 > innerHeight ? r.top - h - 8 : r.bottom + 8;
    pop.style.left = left + 'px';
    pop.style.top = Math.max(8, top) + 'px';
    a.setAttribute('aria-describedby', 'fw-pop');
  };
  const hide = (a) => {
    clearTimeout(timer);
    pop.hidden = true;
    a?.removeAttribute('aria-describedby');
  };
  const canHover = matchMedia('(hover: hover)');
  document.addEventListener('mouseover', (e) => {
    if (!canHover.matches) return;
    const a = e.target.closest('a[data-id]');
    if (!a) return;
    clearTimeout(timer);
    timer = setTimeout(() => show(a), 160);
  });
  document.addEventListener('mouseout', (e) => {
    const a = e.target.closest('a[data-id]');
    if (a && !a.contains(e.relatedTarget)) hide(a);
  });
  document.addEventListener('focusin', (e) => {
    const a = e.target.closest?.('a[data-id]');
    if (a && a.matches(':focus-visible')) show(a);
  });
  document.addEventListener('focusout', (e) => {
    const a = e.target.closest?.('a[data-id]');
    if (a) hide(a);
  });
  addEventListener('scroll', () => hide(), { passive: true });
})();
