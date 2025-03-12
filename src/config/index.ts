export const config = {
    api: {
        serverUrl: 'https://clerky-uzni.onrender.com',
        githubApiBase: 'https://api.github.com/repos/iannouvel/clerky',
        githubRawBase: 'https://raw.githubusercontent.com/iannouvel/clerky/main'
    },
    endpoints: {
        health: '/health',
        handleIssues: '/handleIssues',
        guidelines: '/guidance/list_of_guidelines.txt',
        summaries: '/guidance/summary/list_of_summaries.json',
        prompts: '/prompts.json'
    },
    retry: {
        maxRetries: 3,
        baseDelay: 1000, // milliseconds
    },
    ui: {
        spinnerSymbol: '&#x21BB;',
        maxFilesToList: 100,
        maxFilesToLoad: 5
    }
} as const;

// Type for the entire config object
export type Config = typeof config;

// Simple type-safe getter
export function getConfig<K1 extends keyof Config>(key1: K1): Config[K1];
export function getConfig<K1 extends keyof Config, K2 extends keyof Config[K1]>(
    key1: K1,
    key2: K2
): Config[K1][K2];
export function getConfig<
    K1 extends keyof Config,
    K2 extends keyof Config[K1],
    K3 extends keyof Config[K1][K2]
>(key1: K1, key2: K2, key3: K3): Config[K1][K2][K3];
export function getConfig(...keys: string[]): unknown {
    return keys.reduce((obj, key) => obj[key], config as any);
} 