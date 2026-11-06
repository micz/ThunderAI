/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/*
 *  The Smart bar's operation registry (claude-spec/10-smartbar.md "Operation registry").
 *
 *  An operation is one entry:
 *    id            stable string ('tag', 'summarize', 'translate'; later 'compose', 'deliver_draft')
 *    description   for the router model: what it does and when to pick it (English)
 *    params        { name: { type: 'string' | 'string[]' | 'boolean', enum?, description } }: what
 *                  the router may pass; every parameter is optional
 *    requirements  (env) => boolean: whether it can run now (feature on, connection usable,
 *                  permissions granted); env is what availabilityEnv() in the background builds
 *    multiple      whether more than one instance may appear in one instruction (false for all)
 *    risk          'direct' or 'confirm' ('confirm' waits for the user's Confirm)
 *    dependsOn     (ops, index) => indices of the operations of the same instruction this one
 *                  waits for: a static rule, never the model's decision
 *    deliverInChat optional, reserved for the compose operation in chat mode
 *    run           (ctx) => Promise<{ state: 'done' | 'error', result, error, errorType,
 *                  rawResponse, retryAt }>: ctx = { message, params, signal, groupId, index,
 *                  report(partial), source, executors }
 *
 *  Adding an operation means adding one entry here, plus its i18n strings (the result texts are
 *  built by the add-on, never by the model). The executors themselves live in the background,
 *  which hands them to run() through ctx.executors: this module imports nothing, so the level-1
 *  tests load it on its own.
 */

/** The parameter types the schemas use. */
export const PARAM_TYPES = Object.freeze(['string', 'string[]', 'boolean']);

/** The operations of this version, in the order the router sees them. */
export const DEFAULT_OPERATIONS = Object.freeze([
    {
        id: 'tag',
        description: 'Add tags to the email. With "tags", exactly those tags are added (as the user named them). ' +
            'Without it, the tags are chosen automatically by the add-on. Pick it for "tag", "label", "mark as".',
        params: {
            tags: { type: 'string[]', description: 'the tag names the user named; omit to let the add-on choose' },
        },
        requirements: (env) => !!env?.features?.add_tags && !!env?.permissions?.add_tags && !!env?.usable?.add_tags,
        multiple: false,
        risk: 'direct',
        dependsOn: () => [],
        run: (ctx) => ctx.executors.tag(ctx),
    },
    {
        id: 'summarize',
        description: 'Summarize the email. Pick it for "summarize", "summary", "tl;dr", "what does it say".',
        params: {},
        requirements: (env) => !!env?.features?.summarize && !!env?.usable?.summarize,
        multiple: false,
        risk: 'direct',
        dependsOn: () => [],
        run: (ctx) => ctx.executors.summarize(ctx),
    },
    {
        id: 'translate',
        description: 'Translate the email. With "language", into that language (as the user named it). ' +
            'Without it, into the language configured by the user.',
        params: {
            language: { type: 'string', description: 'the target language as the user named it; omit for the configured one' },
        },
        requirements: (env) => !!env?.features?.translate && !!env?.usable?.translate,
        multiple: false,
        risk: 'direct',
        dependsOn: () => [],
        run: (ctx) => ctx.executors.translate(ctx),
    },
]);

const RISKS = ['direct', 'confirm'];

/** The problems of an operation entry, as strings; [] when it is valid. */
export function operationProblems(op) {
    const problems = [];
    if (!op || typeof op !== 'object') return ['not an object'];
    if (typeof op.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(op.id)) problems.push('id must be a lowercase identifier');
    if (typeof op.description !== 'string' || op.description.trim() === '') problems.push('description must be a non-empty string');
    if (!op.params || typeof op.params !== 'object' || Array.isArray(op.params)) problems.push('params must be an object');
    else {
        for (const [name, schema] of Object.entries(op.params)) {
            if (!PARAM_TYPES.includes(schema?.type)) problems.push(`param ${name}: unknown type`);
            if (schema?.enum !== undefined && !Array.isArray(schema.enum)) problems.push(`param ${name}: enum must be an array`);
        }
    }
    for (const fn of ['requirements', 'dependsOn', 'run']) {
        if (typeof op[fn] !== 'function') problems.push(fn + ' must be a function');
    }
    if (typeof op.multiple !== 'boolean') problems.push('multiple must be a boolean');
    if (!RISKS.includes(op.risk)) problems.push('risk must be "direct" or "confirm"');
    return problems;
}

/**
 * Validate and normalize the parameters the router gave an operation.
 * Unknown parameters are refused; types are coerced only where nothing can be lost (a number
 * to a string, a single string to a one-item list, "true"/"false" to a boolean); an empty value
 * is the same as an absent one; an enumeration is checked.
 * @returns {{ ok: true, params: object } | { ok: false, error: string }}
 */
export function validateParams(op, params) {
    if (params === undefined || params === null) params = {};
    if (typeof params !== 'object' || Array.isArray(params)) return { ok: false, error: 'params must be an object' };
    const out = {};
    for (const [name, value] of Object.entries(params)) {
        const schema = op.params?.[name];
        if (!schema) return { ok: false, error: `unknown parameter "${name}"` };
        if (value === undefined || value === null) continue;
        let v = value;
        switch (schema.type) {
            case 'string':
                if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
                if (typeof v !== 'string') return { ok: false, error: `"${name}" must be a string` };
                v = v.trim();
                if (v === '') continue;
                break;
            case 'string[]':
                if (typeof v === 'string') v = [v];
                if (!Array.isArray(v) || v.some(item => typeof item !== 'string')) {
                    return { ok: false, error: `"${name}" must be a list of strings` };
                }
                v = [...new Set(v.map(item => item.trim()).filter(item => item !== ''))];
                if (v.length === 0) continue;
                break;
            case 'boolean':
                if (v === 'true') v = true;
                else if (v === 'false') v = false;
                if (typeof v !== 'boolean') return { ok: false, error: `"${name}" must be true or false` };
                break;
            default:
                return { ok: false, error: `"${name}" has an unknown type` };
        }
        if (Array.isArray(schema.enum)) {
            const values = Array.isArray(v) ? v : [v];
            const bad = values.find(item => !schema.enum.includes(item));
            if (bad !== undefined) return { ok: false, error: `"${name}" must be one of ${schema.enum.join(', ')}` };
        }
        out[name] = v;
    }
    return { ok: true, params: out };
}

/**
 * A registry over a list of operations (DEFAULT_OPERATIONS, or a test's own). Throws on an
 * invalid entry or a duplicated id.
 */
export function createSmartbarRegistry(operations = DEFAULT_OPERATIONS) {
    const byId = new Map();
    for (const op of operations) {
        const problems = operationProblems(op);
        if (problems.length > 0) throw new Error(`Smart bar operation ${op?.id}: ` + problems.join('; '));
        if (byId.has(op.id)) throw new Error(`Smart bar operation ${op.id}: declared twice`);
        byId.set(op.id, op);
    }
    return {
        /** Every operation, in registry order. */
        all() {
            return [...byId.values()];
        },
        /** The operation of an id, or null. */
        get(id) {
            return byId.get(id) || null;
        },
        /** The operations whose requirements hold for env, in registry order. */
        listAvailable(env) {
            return [...byId.values()].filter(op => {
                try {
                    return op.requirements(env) === true;
                } catch (e) {
                    return false;
                }
            });
        },
    };
}

/** The operations as the router prompt lists them: one block per operation. */
export function describeOperations(ops) {
    return ops.map(op => {
        const params = Object.entries(op.params);
        const lines = [`- id: "${op.id}"`, `  ${op.description}`];
        if (params.length === 0) {
            lines.push('  params: none ({})');
        } else {
            lines.push('  params (all optional):');
            for (const [name, schema] of params) {
                const type = schema.type === 'string[]' ? 'list of strings' : schema.type;
                const enumText = Array.isArray(schema.enum) ? ' (one of: ' + schema.enum.join(', ') + ')' : '';
                lines.push(`    - "${name}": ${type}${enumText}, ${schema.description}`);
            }
        }
        return lines.join('\n');
    }).join('\n');
}

/**
 * The operations a validated router output asks for, ready to run: the registry's checks
 * applied, in the order the router gave them (the user's order).
 *
 *   - an id the registry does not know: dropped, reported ('unknown');
 *   - an operation the user cannot run now (its requirements fail): dropped, reported
 *     ('unavailable');
 *   - a second instance of a single-instance operation: dropped, reported ('duplicate');
 *   - invalid params: the line is kept in state 'error' (errorType 'params'), the others run.
 *
 * @param {Array} routed   the router's operations ([{ id, params }])
 * @returns {{ lines: Array, reports: Array<{ kind, id }> }}
 *   lines: [{ index, id, params, state, error, errorType, dependsOn, risk }]
 */
export function planOperations(registry, availableIds, routed) {
    const lines = [];
    const reports = [];
    const seen = new Set();
    for (const item of Array.isArray(routed) ? routed : []) {
        const id = typeof item?.id === 'string' ? item.id.trim() : '';
        const op = registry.get(id);
        if (!op) {
            reports.push({ kind: 'unknown', id: id });
            continue;
        }
        if (!availableIds.includes(id)) {
            reports.push({ kind: 'unavailable', id: id });
            continue;
        }
        if (!op.multiple && seen.has(id)) {
            reports.push({ kind: 'duplicate', id: id });
            continue;
        }
        seen.add(id);
        const checked = validateParams(op, item.params);
        lines.push({
            index: lines.length,
            id: id,
            params: checked.ok ? checked.params : (item.params ?? {}),
            state: checked.ok ? 'queued' : 'error',
            error: checked.ok ? null : checked.error,
            errorType: checked.ok ? null : 'params',
            dependsOn: [],
            risk: op.risk,
        });
    }
    // Static rules, never the model's: each operation names the earlier ones it waits for.
    for (const line of lines) {
        const op = registry.get(line.id);
        const deps = op.dependsOn(lines.map(l => ({ id: l.id, params: l.params, index: l.index })), line.index) || [];
        // Only an earlier operation: the user's order is the run order, so a line can never
        // wait for one that comes after it (and no cycle can form).
        line.dependsOn = [...new Set(deps.filter(d => Number.isInteger(d) && d >= 0 && d < line.index))];
    }
    return { lines, reports };
}

/**
 * Run the planned lines of one instruction:
 *   - in the user's order, at most `limit` at once (the others wait their turn, first come
 *     first served);
 *   - a line waits for the lines it depends on, and is cancelled if one of them did not end
 *     'done';
 *   - a 'confirm' line goes to 'pending_confirmation' and waits for confirm(line), WITHOUT
 *     holding a slot: true runs it, false cancels it;
 *   - a line already in 'error' (invalid params) is left as it is;
 *   - once `signal` aborts, a line not started yet is cancelled.
 *
 * start(line) runs one line and resolves its outcome { state: 'done' | 'error', ... }; it must
 * not reject (a rejection is taken as an error). onChange(line) is called on every state change.
 * Resolves the lines once every one is in a final state.
 */
export async function runPlanned({ lines, limit = 3, start, confirm = async () => false, onChange = () => {}, signal = null }) {
    const cap = Number.isInteger(limit) && limit >= 1 ? limit : 1;
    let active = 0;
    const waiting = [];
    const acquire = () => new Promise(resolve => {
        if (active < cap) {
            active++;
            resolve();
        } else {
            waiting.push(resolve);
        }
    });
    const release = () => {
        const next = waiting.shift();
        if (next) next();
        else active--;
    };
    const set = (line, patch) => {
        Object.assign(line, patch);
        try { onChange(line); } catch (e) { /* a display callback never stops the run */ }
    };
    const aborted = () => signal?.aborted === true;

    const finals = [];
    for (const line of lines) {
        const deps = line.dependsOn.map(i => finals[i]);
        finals[line.index] = (async () => {
            if (line.state === 'error') return line;
            const depLines = await Promise.all(deps);
            if (depLines.some(d => d.state !== 'done') || aborted()) {
                set(line, { state: 'cancelled', finishedAt: Date.now() });
                return line;
            }
            if (line.risk === 'confirm') {
                set(line, { state: 'pending_confirmation' });
                let ok = false;
                try { ok = (await confirm(line)) === true; } catch (e) { ok = false; }
                if (!ok || aborted()) {
                    set(line, { state: 'cancelled', finishedAt: Date.now() });
                    return line;
                }
            }
            await acquire();
            try {
                if (aborted()) {
                    set(line, { state: 'cancelled', finishedAt: Date.now() });
                    return line;
                }
                set(line, { state: 'running' });
                let outcome;
                try {
                    outcome = await start(line);
                } catch (e) {
                    outcome = { state: 'error', error: e?.message || String(e), errorType: e?.aborted ? 'aborted' : 'api' };
                }
                const state = outcome?.state === 'done' ? 'done'
                    : (outcome?.state === 'cancelled' ? 'cancelled' : 'error');
                set(line, {
                    state: state,
                    result: outcome?.result ?? null,
                    error: state === 'error' ? (outcome?.error || 'error') : null,
                    errorType: state === 'error' ? (outcome?.errorType || 'api') : null,
                    rawResponse: outcome?.rawResponse ?? null,
                    retryAt: outcome?.retryAt ?? null,
                    finishedAt: Date.now(),
                });
                return line;
            } finally {
                release();
            }
        })();
    }
    await Promise.all(finals);
    return lines;
}
