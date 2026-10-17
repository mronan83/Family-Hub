// Types for the e2e specs that import scripts/e2e-infra.mjs (DEV-05 and MEAL-09's evidence, D-129).
export declare const SLOW_READ_MS: number;
export declare function slowReads(reads: (number | null)[], what?: string): string | null;
export declare function loadWords(done: number[], out: number | null): string;
export declare function healthReading(status: number, ms: number): string | null;
