/*
 *  Known issues, managed layer: the core mechanism (./core/known-issues.mjs) with the managed
 *  entries and their shape (./known-issues/managed.mjs), under the names the managed tests
 *  have always imported. knownTest() names the managed file when an entry goes stale.
 *
 *  No jsdom here, so level 1 can import it.
 */

import { knownTest as coreKnownTest } from './core/known-issues.mjs';

export { runKnown } from './core/known-issues.mjs';

export {
    REASONS,
    KNOWN,
    validateKnown,
    todoFor,
} from './known-issues/managed.mjs';

const FILE = 'tests/helpers/known-issues/managed.mjs';

/** test(), with a managed known-issue reason (or none): see ./core/known-issues.mjs. */
export function knownTest(name, reason, fn) {
    return coreKnownTest(name, reason, fn, { file: FILE });
}
