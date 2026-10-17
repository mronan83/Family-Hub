import type { FoldLine } from '@/lib/setup-facts';

/** [NFR-18] A folded header's line (WP-94): its words, the key facts in bold. */
export function Line({ line }: { line: FoldLine }) {
  return <>{line.map((part, i) => (typeof part === 'string' ? part : <b key={i}>{part.b}</b>))}</>;
}
