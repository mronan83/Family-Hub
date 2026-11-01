// Types for e2e/ui/test.ts, which imports scripts/next-prefetch.mjs (WP-118).
import type { BrowserContext } from '@playwright/test';

export declare function isRouterPrefetch(url: string, headers: Record<string, string>): boolean;
export declare function answerPrefetches(context: BrowserContext): Promise<void>;
