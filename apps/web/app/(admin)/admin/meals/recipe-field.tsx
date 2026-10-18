'use client';

import { Button, Icon } from '@familywise/ui';
import { useRef, useState } from 'react';
import type { Ingredient, RecipeFile } from '@/lib/meals';
import { sizeWords } from '@/lib/meals';
import { pdfText, photoText, type Ocr, type PdfJs } from '@/lib/recipe-files';
import { ingredientLines, ingredientRows } from '@/lib/recipe-read';
import { browserClient } from '@/lib/supabase/browser';
import { addRecipeFile, removeRecipeFile } from './actions';

// The open-source readers' files, served by jsdelivr at the versions installed (no paid service).
const PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs';
const MAX = 10 * 1024 * 1024;
const TYPES = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

type Status = { kind: 'ok' | 'warn'; text: string } | null;

const LINK_WHY: Record<string, string> = {
  bad_link: 'That isn’t a web link. It starts with https://.',
  private: 'That link isn’t a public web page, so it can’t be read.',
  unreachable: 'That page didn’t answer. Try again, or type the ingredients in.',
  too_big: 'That page is too big to read. Type the ingredients in.',
  not_a_page: 'That link isn’t a web page. Add a PDF or photo of it instead.',
  no_recipe: 'That page doesn’t publish its recipe, so nothing was read. Type the ingredients in.',
};

/**
 * [MEAL-25] A meal's Recipe in its form (WP-105, D-138 (6), Q21): a link, with Read ingredients from
 * the recipe data the page publishes; photos and PDFs, up to 10 MB each, kept in the household's
 * storage, each with Read ingredients (a PDF's text with pdf.js, a photo's with Tesseract.js, both
 * on this device); what is found goes into Ingredients for the admin to check before saving.
 */
export function RecipeField({
  mealId,
  householdId,
  url: initialUrl,
  files: initialFiles,
  onRows,
}: {
  /** None for a new meal: photos and PDFs are added once it is saved. */
  mealId?: string;
  householdId: string;
  url: string | null;
  files: readonly RecipeFile[];
  onRows: (rows: Ingredient[]) => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? '');
  const [steps, setSteps] = useState<readonly string[] | null>(null);
  const [files, setFiles] = useState<readonly RecipeFile[]>(initialFiles);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const found = (n: number, from: string) =>
    setStatus(
      n > 0
        ? {
            kind: 'ok',
            text: `Found ${n} ingredient${n === 1 ? '' : 's'} ${from}. They are filled in below for you to check.`,
          }
        : { kind: 'warn', text: `No ingredients found ${from}. Type them in below.` },
    );

  async function readLink() {
    setBusy('link');
    setStatus(null);
    try {
      const res = await fetch('/api/recipes/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const body = (await res.json()) as
        | { ok: true; ingredients: Ingredient[]; steps: string[]; site: string }
        | { ok: false; why: string };
      if (!body.ok) {
        setStatus({ kind: 'warn', text: LINK_WHY[body.why] ?? LINK_WHY.unreachable! });
        return;
      }
      if (body.ingredients.length) onRows(body.ingredients);
      setSteps(body.steps);
      found(body.ingredients.length, 'on the page');
    } catch {
      setStatus({ kind: 'warn', text: LINK_WHY.unreachable! });
    } finally {
      setBusy(null);
    }
  }

  async function readFile(f: RecipeFile) {
    const db = browserClient();
    if (!db) return;
    setBusy(f.id);
    setStatus(null);
    try {
      const { data, error } = await db.storage.from('recipes').download(f.path);
      if (error || !data) throw new Error('not downloaded');
      let text: string;
      if (f.kind === 'pdf') {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;
        text = await pdfText(pdfjs as unknown as PdfJs, new Uint8Array(await data.arrayBuffer()));
      } else {
        const ocr = (await import('tesseract.js')) as unknown as { default?: Ocr } & Ocr;
        text = await photoText(ocr.default ?? ocr, data);
      }
      const rows = ingredientRows(ingredientLines(text));
      if (rows.length) onRows(rows);
      found(rows.length, `in ${f.name}`);
    } catch {
      setStatus({ kind: 'warn', text: `${f.name} couldn’t be read. Type the ingredients in.` });
    } finally {
      setBusy(null);
    }
  }

  async function add(file: File) {
    const db = browserClient();
    if (!db || !mealId) return;
    if (file.size > MAX || !TYPES.split(',').includes(file.type)) {
      setStatus({ kind: 'warn', text: 'A photo or a PDF, up to 10 MB.' });
      return;
    }
    setBusy('add');
    setStatus(null);
    const ext = file.type === 'application/pdf' ? 'pdf' : (file.type.split('/')[1] ?? 'jpg');
    const path = `${householdId}/${mealId}/${crypto.randomUUID()}.${ext}`;
    try {
      const up = await db.storage.from('recipes').upload(path, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      const saved = await addRecipeFile({
        mealId,
        path,
        name: file.name,
        type: file.type,
        size: file.size,
      });
      if ('error' in saved) {
        setStatus({ kind: 'warn', text: saved.error });
        return;
      }
      setFiles((was) => [
        ...was,
        {
          id: saved.id,
          kind: file.type === 'application/pdf' ? 'pdf' : 'photo',
          name: file.name,
          path,
          sizeBytes: file.size,
        },
      ]);
    } catch {
      setStatus({ kind: 'warn', text: 'That didn’t upload. Try again in a moment.' });
    } finally {
      setBusy(null);
      if (picker.current) picker.current.value = '';
    }
  }

  async function remove(f: RecipeFile) {
    setBusy(f.id);
    const { ok } = await removeRecipeFile(f.id);
    if (ok) setFiles((was) => was.filter((x) => x.id !== f.id));
    setBusy(null);
  }

  return (
    <fieldset className="fw-field fw-fieldset fw-recipe">
      <legend className="fw-field__label">Recipe</legend>
      {steps ? <input type="hidden" name="recipeSteps" value={JSON.stringify(steps)} /> : null}
      <div className="fw-recipe__link">
        <label className="fw-recipe__url">
          <span className="fw-visually-hidden">Recipe link</span>
          <input
            className="fw-input"
            name="recipeUrl"
            type="url"
            maxLength={500}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
            placeholder="https://"
          />
        </label>
        <Button
          variant="secondary"
          disabled={!url.trim() || busy !== null}
          aria-busy={busy === 'link' || undefined}
          onClick={() => void readLink()}
        >
          {busy === 'link' ? 'Reading…' : 'Read ingredients'}
        </Button>
      </div>
      {status ? (
        <p className={`fw-recipe__status fw-recipe__status--${status.kind}`} role="status">
          <Icon name={status.kind === 'ok' ? 'check-circle' : 'info'} size={16} />
          {status.text}
        </p>
      ) : null}
      {files.length > 0 ? (
        <ul className="fw-recipe__files" aria-label="Photos and PDFs">
          {files.map((f) => (
            <li key={f.id} className="fw-recipe__file">
              <span className="fw-recipe__thumb" aria-hidden>
                <Icon name={f.kind === 'pdf' ? 'book' : 'image'} size={28} />
              </span>
              <span className="fw-recipe__about">
                <strong>{f.name}</strong>
                <span className="fw-muted">
                  {f.kind === 'pdf' ? 'PDF' : 'Photo'} · {sizeWords(f.sizeBytes)} ·{' '}
                  <button
                    type="button"
                    className="fw-recipe__read"
                    disabled={busy !== null}
                    aria-busy={busy === f.id || undefined}
                    onClick={() => void readFile(f)}
                    aria-label={`Read ingredients from ${f.name}`}
                  >
                    {busy === f.id ? 'Reading…' : 'Read ingredients'}
                  </button>
                </span>
              </span>
              <button
                type="button"
                className="fw-ing__x"
                aria-label={`Remove ${f.name}`}
                disabled={busy !== null}
                onClick={() => void remove(f)}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {mealId ? (
        <>
          <input
            ref={picker}
            className="fw-visually-hidden"
            type="file"
            accept={TYPES}
            aria-label="Choose a photo or PDF"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void add(f);
            }}
          />
          <Button
            variant="secondary"
            icon="plus"
            disabled={busy !== null}
            aria-busy={busy === 'add' || undefined}
            onClick={() => picker.current?.click()}
          >
            {busy === 'add' ? 'Adding…' : 'Add a photo or PDF'}
          </Button>
          <span className="fw-field__help">
            Up to 10 MB each. A photo’s text is read on this device with free open-source text
            reading; what it finds is filled in below for you to check.
          </span>
        </>
      ) : (
        <span className="fw-field__help">
          Add photos and PDFs of the recipe once the meal is saved.
        </span>
      )}
    </fieldset>
  );
}
