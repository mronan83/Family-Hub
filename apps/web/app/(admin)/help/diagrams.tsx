'use client';
import { useEffect } from 'react';

/** Below this width a left-to-right flowchart is drawn top to bottom, so it fits a phone. */
const NARROW = 640;
/** A diagram shrunk below this to fit is shown full size and scrolls sideways instead. */
const MIN_SCALE = 0.6;

/**
 * [D-72] Draws the guide's diagrams (mermaid source in the page) once the page is in the browser,
 * in the theme the admin app is showing. Until then, and if drawing fails, the source stays as text.
 */
export function HelpDiagrams() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const nodes = [...document.querySelectorAll<HTMLElement>('.fw-help pre.mermaid')];
      if (!nodes.length) return;
      const { default: mermaid } = await import('mermaid');
      if (cancelled) return;
      const evening = document.documentElement.dataset.theme === 'evening';
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: evening ? 'dark' : 'neutral',
        fontFamily: 'Inter, system-ui, sans-serif',
      });
      const sources = nodes.map((n) => n.textContent ?? '');
      const draw = async (which: HTMLElement[]) => {
        try {
          await mermaid.run({ nodes: which });
          return true;
        } catch {
          // The diagram's source stays readable as text.
          return false;
        }
      };
      const topDown = (src: string) => src.replace(/^flowchart LR\b/m, 'flowchart TD');
      if (window.innerWidth < NARROW)
        nodes.forEach((n, i) => (n.textContent = topDown(sources[i]!)));
      if (!(await draw(nodes)) || cancelled) return;

      // A left-to-right diagram too wide to read at this size is drawn again top to bottom; one
      // still too wide keeps its full size and scrolls sideways in its box.
      const scale = (node: HTMLElement) => {
        const svg = node.querySelector('svg');
        const box = node.closest<HTMLElement>('.fw-help__diagram');
        const natural = svg?.viewBox.baseVal.width ?? 0;
        return svg && box && natural ? (box.clientWidth - 32) / natural : 1;
      };
      const again = nodes.filter(
        (n, i) => scale(n) < MIN_SCALE && topDown(sources[i]!) !== sources[i],
      );
      for (const n of again) {
        n.removeAttribute('data-processed');
        n.textContent = topDown(sources[nodes.indexOf(n)]!);
      }
      if (again.length && !(await draw(again))) return;
      for (const node of nodes) {
        const svg = node.querySelector('svg');
        const box = node.closest<HTMLElement>('.fw-help__diagram');
        if (!svg || !box || scale(node) >= MIN_SCALE) continue;
        svg.style.maxWidth = 'none';
        svg.style.width = `${svg.viewBox.baseVal.width}px`;
        box.style.justifyItems = 'start';
      }
      // Said on the page once every diagram is in its final shape (the UI suite waits for it).
      document.querySelector('.fw-help')?.setAttribute('data-diagrams', 'drawn');
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
