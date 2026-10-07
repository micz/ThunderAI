/*
 *  The real storage.sync dumps of tests/fixtures/migration/captured/ (README, "Adding a captured
 *  dump").
 *
 *  A dump is what the Thunderbird debugger console prints for
 *      JSON.stringify(await browser.storage.sync.get(null), null, 2)
 *  pasted into a file whose name contains ".sync." (any extension). The console's trailing noise
 *  ("debugger eval code:6:11") is tolerated: the object is read from the first "{" to the last "}".
 *  An optional companion file, the same name with ".local." for ".sync.", holds that profile's
 *  storage.local; without one, the 5.0.x fixture's storage.local is used, so the payloads are
 *  exercised all the same.
 *
 *  Not a test file (no .test.mjs suffix). Imports only the core, never jsdom.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { repoPath } from '../helpers/core/load.mjs';

export const CAPTURE_DIR = 'tests/fixtures/migration/captured';

/** Parse a console dump: the JSON object between the first "{" and the last "}". */
export function parseDump(text, name) {
    const from = text.indexOf('{');
    const to = text.lastIndexOf('}');
    if (from === -1 || to < from) throw new Error(name + ': no JSON object in the dump');
    const obj = JSON.parse(text.slice(from, to + 1));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(name + ': the dump is not an object');
    return obj;
}

/** Every capture: [{name, sync, local | null}]. */
export function captures() {
    const dir = repoPath(CAPTURE_DIR);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(f => f.includes('.sync.')).sort().map(name => {
        const sync = parseDump(readFileSync(dir + '/' + name, 'utf8'), name);
        const companion = name.replace('.sync.', '.local.');
        const local = existsSync(dir + '/' + companion)
            ? parseDump(readFileSync(dir + '/' + companion, 'utf8'), companion)
            : null;
        return { name, sync, local };
    });
}

/**
 * True for a value that is obviously not a real secret: empty, one character repeated
 * ("0000..."), or starting with "fake" / "test".
 */
export function isFakeSecret(v) {
    if (v === '' || v === null || v === undefined) return true;
    if (typeof v !== 'string') return false;
    return /^(.)\1*$/.test(v) || /^(fake|test)/i.test(v);
}

/** Every *_api_key in a storage object, top level and inside prompt objects: [[path, value]]. */
export function apiKeys(obj, path = '') {
    const out = [];
    if (Array.isArray(obj)) {
        obj.forEach((v, i) => out.push(...apiKeys(v, path + '[' + i + ']')));
    } else if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
            const at = path ? path + '.' + k : k;
            if (k.endsWith('_api_key')) out.push([at, v]);
            else out.push(...apiKeys(v, at));
        }
    }
    return out;
}
