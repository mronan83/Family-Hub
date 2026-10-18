// Types for e2e/support/household.ts, which imports scripts/e2e-household.mjs (WP-111, D-137).
export declare const DEMO_PREFIX: string;
export declare const PERSONAS: string[];
export declare function checkKey(key: string): string;
export declare function prefixOf(key: string): string;
export declare function ownId(key: string, seedId: string): string;
export declare function householdId(key: string): string;
export declare function personaEmail(key: string, persona: string): string;
export declare function removeSql(key: string): string;
export declare function createSql(key: string, seed: string): string;
export declare function demoPassword(secret: string, email: string): string;
export declare function passwordSql(key: string, secret: string): string;
export declare function oneTrip(sql: string): string;
