import type { Page } from '@playwright/test';
import { sql } from './db';

const DEMO = '0de00000-0000-4000-8000-000000000001';

/**
 * Retires a board a spec paired, once the spec is done with it. Its browser context closes, so it
 * stops listening and sending, and its device is removed, so anything it left queued can't reach the
 * demo family. Files run one after another in one browser, so without this every board stays live
 * for the rest of the run: since WP-20 any of them can take a goal's celebration ("whichever board
 * shows it first"), and any can replay a check-off from its outbox in the middle of another spec.
 */
export async function retireBoard(board: Page | undefined, name: string): Promise<void> {
  await board
    ?.context()
    .close()
    .catch(() => {});
  const db = process.env.SUPABASE_DB_URL;
  if (!db) return;
  sql(
    db,
    `delete from public.device_pairing where household_id = '${DEMO}' and device_name = '${name}';
     delete from public.device where household_id = '${DEMO}' and name = '${name}';`,
  );
}
