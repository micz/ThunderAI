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
 *  The SmartBar's operation registry (claude-spec/10-smartbar.md "Operation registry").
 *
 *  An operation is one entry:
 *    id            stable string, unique across both contexts ('tag', 'summarize', 'translate',
 *                  'delete_summary', 'delete_translation', 'spam_check', 'delete_spam_report',
 *                  'calendar_event', 'task', 'compose', 'deliver_draft'; in a compose window
 *                  'rewrite', 'proofread', 'translate_text', 'subject', 'select')
 *    context       'message' (the email being read: the bar and its chat) or 'compose' (the
 *                  email being written: the chat of a compose window,
 *                  claude-spec/10-smartbar-compose.md); the router of a context is offered only
 *                  that context's operations
 *    description   for the router model: what it does and when to pick it (English)
 *    params        { name: { type: 'string' | 'string[]' | 'boolean', enum?, required?, description } }:
 *                  what the router may pass; a parameter is optional unless `required`
 *    requirements  (env) => boolean: whether it can run now (feature on, connection usable,
 *                  permissions granted); env is what _smartbarEnv() in the background builds,
 *                  with `source` ('bar' | 'chat' | 'compose'), `draft` (the current draft of the
 *                  chat's session, or null), `context` ('message' when absent) and, in a compose
 *                  window, `compose` ({ isPlainText })
 *    multiple      whether more than one instance may appear in one instruction (false for all)
 *    risk          'direct' or 'confirm' ('confirm' waits for the user's Confirm)
 *    exclusive     optional: a group name; of the lines of one instruction sharing it, only the
 *                  first in the user's order is planned, the others are reported 'conflict'
 *                  ('body': the proposals of a new text for the body of the email being written)
 *    runLast       optional: the operation runs after every other operation of the instruction
 *                  has ended (compose, calendar_event, task: their window opens at the end and
 *                  steals no focus mid-way)
 *    dependsOn     (ops, index) => indices of the operations of the same instruction this one
 *                  waits for: a static rule, never the model's decision. It may name a line the
 *                  user gave later: the plan moves a line after the lines it waits for
 *    deliverInChat optional: in the chat (source 'chat') the operation does not deliver when it
 *                  ends; it ends 'drafted' and the user delivers it later (compose: its draft)
 *    run           (ctx) => Promise<{ state: 'done' | 'drafted' | 'error' | 'cancelled', result,
 *                  error, errorType, rawResponse, retryAt }>: ctx = { message, params, signal,
 *                  groupId, index, report(partial), source, executors }
 *
 *  Adding an operation means adding one entry here, plus its i18n strings (the result texts are
 *  built by the add-on, never by the model). The executors themselves live in the background,
 *  which hands them to run() through ctx.executors: this module imports nothing, so the level-1
 *  tests load it on its own.
 */

/** The parameter types the schemas use. */
export const PARAM_TYPES = Object.freeze(['string', 'string[]', 'boolean']);

/** The two contexts of the operations: the email being read, the email being written. */
export const CONTEXTS = Object.freeze(['message', 'compose']);

/** The scopes of a change to the email being written: the selection, or the whole text written. */
export const COMPOSE_SCOPES = Object.freeze(['selection', 'all']);

/** The context of an availability env: 'message' unless it says 'compose'. */
export function envContext(env) {
    return env?.context === 'compose' ? 'compose' : 'message';
}

/** Whether an env is the chat of a compose window. */
const composeEnv = (env) => envContext(env) === 'compose';

/** A change of the body waits for a select of the same instruction: it works on the selection. */
const dependsOnSelect = (ops, index) => ops.filter(o => o.id === 'select' && o.index !== index).map(o => o.index);

/** The operations of this version, in the order the router sees them. */
export const DEFAULT_OPERATIONS = Object.freeze([
    {
        id: 'tag',
        context: 'message',
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
        context: 'message',
        description: 'Summarize the email. Pick it for "summarize", "summary", "tl;dr", "what does it say".',
        params: {},
        requirements: (env) => !!env?.features?.summarize && !!env?.usable?.summarize,
        multiple: false,
        risk: 'direct',
        // "Delete the summary and summarize again": the deletion first, whatever the user's order.
        dependsOn: (ops, index) => ops.filter(o => o.id === 'delete_summary' && o.index !== index).map(o => o.index),
        run: (ctx) => ctx.executors.summarize(ctx),
    },
    {
        id: 'translate',
        context: 'message',
        description: 'Translate the email. With "language", into that language (as the user named it). ' +
            'Without it, into the language configured by the user.',
        params: {
            language: { type: 'string', description: 'the target language as the user named it; omit for the configured one' },
        },
        requirements: (env) => !!env?.features?.translate && !!env?.usable?.translate,
        multiple: false,
        risk: 'direct',
        // "Delete the translation and translate again": the deletion first.
        dependsOn: (ops, index) => ops.filter(o => o.id === 'delete_translation' && o.index !== index).map(o => o.index),
        run: (ctx) => ctx.executors.translate(ctx),
    },
    {
        id: 'delete_summary',
        context: 'message',
        description: 'Delete the stored summary of the email (it disappears from the message). ' +
            'Pick it for "delete the summary", "remove the summary", "cancella il riassunto". ' +
            'Not for "summarize again": that is "summarize".',
        params: {},
        // No model call: the feature on is enough, whatever its connection.
        requirements: (env) => !!env?.features?.summarize,
        multiple: false,
        risk: 'direct',
        // A summarize of the same instruction waits for this one (its dependsOn).
        dependsOn: () => [],
        run: (ctx) => ctx.executors.delete_summary(ctx),
    },
    {
        id: 'delete_translation',
        context: 'message',
        description: 'Delete the stored translation of the email (it disappears from the message). ' +
            'Pick it for "delete the translation", "remove the translation", "cancella la traduzione".',
        params: {},
        requirements: (env) => !!env?.features?.translate,
        multiple: false,
        risk: 'direct',
        dependsOn: () => [],
        run: (ctx) => ctx.executors.delete_translation(ctx),
    },
    {
        id: 'spam_check',
        context: 'message',
        description: 'Check whether the email is spam with the spam filter and show its report (a spam score and ' +
            'an explanation); it never moves the email. Pick it for "is it spam?", "check for spam", "antispam", ' +
            '"è spam?", "controlla lo spam".',
        params: {},
        requirements: (env) => !!env?.features?.spamfilter && !!env?.permissions?.spamfilter && !!env?.usable?.spamfilter,
        multiple: false,
        risk: 'direct',
        // "Delete the spam report and check again": the deletion first, or it would delete the
        // new report.
        dependsOn: (ops, index) => ops.filter(o => o.id === 'delete_spam_report' && o.index !== index).map(o => o.index),
        run: (ctx) => ctx.executors.spam_check(ctx),
    },
    {
        id: 'delete_spam_report',
        context: 'message',
        description: 'Delete the stored spam report of the email (it disappears from the message); it never moves ' +
            'the email. Pick it for "delete the spam report", "remove the spam check", "cancella il report antispam". ' +
            'Not for "check for spam again": that is "spam_check".',
        params: {},
        // No model call and no message moved: the feature on is enough, whatever its connection
        // and its permissions.
        requirements: (env) => !!env?.features?.spamfilter,
        multiple: false,
        risk: 'direct',
        // A spam_check of the same instruction waits for this one (its dependsOn).
        dependsOn: () => [],
        run: (ctx) => ctx.executors.delete_spam_report(ctx),
    },
    {
        id: 'calendar_event',
        context: 'message',
        description: 'Create a calendar event from the email: its data are read from the email and Thunderbird\'s ' +
            'event dialog opens, where the user reviews and saves it. Pick it for "add to calendar", "create an ' +
            'event", "save the meeting", "aggiungi al calendario", "crea un evento".',
        params: {},
        // ThunderAI Sparks opens the dialog: it is checked when the line runs, so a missing or
        // outdated Sparks is said in the line instead of hiding the operation.
        requirements: (env) => !!env?.features?.get_calendar_event && !!env?.usable?.get_calendar_event,
        multiple: false,
        risk: 'direct',
        // Its dialog steals the focus: after the other lines, like a compose window.
        runLast: true,
        dependsOn: () => [],
        run: (ctx) => ctx.executors.calendar_event(ctx),
    },
    {
        id: 'task',
        context: 'message',
        description: 'Create a task (a to-do) from the email: its data are read from the email and Thunderbird\'s ' +
            'task dialog opens, where the user reviews and saves it. Pick it for "create a task", "add a to-do", ' +
            '"remind me to do it", "crea un\'attività", "aggiungi un task".',
        params: {},
        requirements: (env) => !!env?.features?.get_task && !!env?.usable?.get_task,
        multiple: false,
        risk: 'direct',
        runLast: true,
        dependsOn: () => [],
        run: (ctx) => ctx.executors.task(ctx),
    },
    {
        id: 'compose',
        context: 'message',
        description: 'Write a new email from this one and open it in a compose window, where the user reviews it ' +
            'and adds the recipients: a reply, a reply to all, a forward with a note, or a brand-new email about it. ' +
            'Pick it whenever the user wants to answer, reply, forward or write an email. "type": "reply" by default ' +
            'for any reply; "reply_all" only when the user explicitly asks to reply to all ("reply to all", ' +
            '"rispondi a tutti"); "forward" when the user wants to send this email on to someone else; "new" when the ' +
            'user wants a fresh email, not threaded to this one. Never put recipients in the params.',
        params: {
            type: { type: 'string', enum: ['reply', 'reply_all', 'forward', 'new'], required: true, description: 'the kind of email to write' },
        },
        requirements: (env) => !!env?.usable?.smartbar_execute,
        multiple: false,
        risk: 'direct',
        runLast: true,
        deliverInChat: true,
        dependsOn: () => [],
        run: (ctx) => ctx.executors.compose(ctx),
    },
    {
        id: 'deliver_draft',
        context: 'message',
        description: 'Create the email from the current draft of this conversation now, in a compose window: the user ' +
            'approves the draft ("create the email", "ok go", "that\'s fine", "crea l\'email", "ok vai"). It does not ' +
            'change the draft: a request to change it ("shorter", "more formal", "add that...") is a compose operation, ' +
            'and "make it shorter and create it" is a compose operation followed by this one.',
        params: {},
        // Only in the chat, and only while its session holds a draft not delivered yet.
        requirements: (env) => env?.source === 'chat' && !!env?.draft,
        multiple: false,
        risk: 'direct',
        // A compose operation of the same instruction writes the draft this one delivers: wait
        // for it, wherever the user put it ("make it shorter and create it").
        dependsOn: (ops, index) => ops.filter(o => o.id === 'compose' && o.index !== index).map(o => o.index),
        run: (ctx) => ctx.executors.deliver_draft(ctx),
    },
    // The email being written (claude-spec/10-smartbar-compose.md): the chat of a compose window.
    // Every change is a proposal the user applies (deliverInChat: 'drafted', then Apply), but
    // select, which changes the selection only.
    {
        id: 'rewrite',
        context: 'compose',
        description: 'Propose a new version of the text the user is writing, following the instruction: change its ' +
            'tone, length or formality, add or remove something, or, when the text is empty, write what the user ' +
            'asks for ("write that I accept"). A combination of changes ("correct it and make it more formal") is ' +
            'one rewrite. Pick it for "rewrite", "shorter", "more formal", "add that...", "riscrivi", "più breve".',
        params: {
            scope: { type: 'string', enum: COMPOSE_SCOPES, description: 'what to change: "selection" the selected text, ' +
                '"all" the whole text written; omit for the selection when there is one, else the whole text' },
        },
        requirements: (env) => composeEnv(env) && !!env?.usable?.smartbar_compose,
        multiple: false,
        risk: 'direct',
        exclusive: 'body',
        deliverInChat: true,
        dependsOn: dependsOnSelect,
        run: (ctx) => ctx.executors.rewrite(ctx),
    },
    {
        id: 'proofread',
        context: 'compose',
        description: 'Propose the text the user is writing with its spelling, grammar and punctuation corrected, ' +
            'nothing else changed. Pick it for "correct", "proofread", "check the spelling", "correggi". When other ' +
            'changes are asked with the correction, pick "rewrite" instead.',
        params: {
            scope: { type: 'string', enum: COMPOSE_SCOPES, description: 'what to correct: "selection" or "all"; omit for ' +
                'the selection when there is one, else the whole text' },
        },
        requirements: (env) => composeEnv(env) && !!env?.usable?.smartbar_compose,
        multiple: false,
        risk: 'direct',
        exclusive: 'body',
        deliverInChat: true,
        dependsOn: dependsOnSelect,
        run: (ctx) => ctx.executors.proofread(ctx),
    },
    {
        id: 'translate_text',
        context: 'compose',
        description: 'Propose the text the user is writing translated into another language. Pick it for ' +
            '"translate it into English", "traducilo in tedesco". The language is required: as the user named it.',
        params: {
            language: { type: 'string', required: true, description: 'the target language as the user named it' },
            scope: { type: 'string', enum: COMPOSE_SCOPES, description: 'what to translate: "selection" or "all"; omit for ' +
                'the selection when there is one, else the whole text' },
        },
        requirements: (env) => composeEnv(env) && !!env?.usable?.smartbar_compose,
        multiple: false,
        risk: 'direct',
        exclusive: 'body',
        deliverInChat: true,
        dependsOn: dependsOnSelect,
        run: (ctx) => ctx.executors.translate_text(ctx),
    },
    {
        id: 'subject',
        context: 'compose',
        description: 'Propose a subject for the email being written, from its text and the hints of the instruction ' +
            '("short", "in English"). Pick it for "write the subject", "suggest a subject", "metti l\'oggetto".',
        params: {},
        requirements: (env) => composeEnv(env) && !!env?.usable?.smartbar_compose,
        multiple: false,
        risk: 'direct',
        deliverInChat: true,
        dependsOn: () => [],
        run: (ctx) => ctx.executors.subject(ctx),
    },
    {
        id: 'select',
        context: 'compose',
        description: 'Select a passage of the text the user is writing, described in the user\'s words ("the second ' +
            'paragraph", "the sentence about the prices"). It changes the selection only, never the text. Pick it for ' +
            '"select...", "seleziona...". Asked with a change ("select the last paragraph and translate it"), give ' +
            'select and the change: the change then works on the selection.',
        params: {
            target: { type: 'string', required: true, description: 'the passage to select, as the user described it' },
        },
        // Not in a plain text compose window.
        requirements: (env) => composeEnv(env) && !!env?.usable?.smartbar_compose && env?.compose?.isPlainText !== true,
        multiple: false,
        risk: 'direct',
        // The operations of the same instruction that change the body wait for it (their dependsOn).
        dependsOn: () => [],
        run: (ctx) => ctx.executors.select(ctx),
    },
]);

/** The states a line ends in successfully: those a line depending on it accepts. */
export const SUCCESS_STATES = Object.freeze(['done', 'drafted']);

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
            if (schema?.required !== undefined && typeof schema.required !== 'boolean') problems.push(`param ${name}: required must be a boolean`);
        }
    }
    for (const fn of ['requirements', 'dependsOn', 'run']) {
        if (typeof op[fn] !== 'function') problems.push(fn + ' must be a function');
    }
    if (typeof op.multiple !== 'boolean') problems.push('multiple must be a boolean');
    if (!RISKS.includes(op.risk)) problems.push('risk must be "direct" or "confirm"');
    if (!CONTEXTS.includes(op.context)) problems.push('context must be "message" or "compose"');
    if (op.exclusive !== undefined && (typeof op.exclusive !== 'string' || op.exclusive === '')) {
        problems.push('exclusive must be a non-empty string');
    }
    for (const flag of ['runLast', 'deliverInChat']) {
        if (op[flag] !== undefined && typeof op[flag] !== 'boolean') problems.push(flag + ' must be a boolean');
    }
    return problems;
}

/**
 * Validate and normalize the parameters the router gave an operation.
 * Unknown parameters are refused; types are coerced only where nothing can be lost (a number
 * to a string, a single string to a one-item list, "true"/"false" to a boolean); an empty value
 * is the same as an absent one; an enumeration is checked; a required parameter must be there
 * once the empty values are dropped.
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
    for (const [name, schema] of Object.entries(op.params || {})) {
        if (schema?.required === true && out[name] === undefined) return { ok: false, error: `"${name}" is required` };
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
        if (problems.length > 0) throw new Error(`SmartBar operation ${op?.id}: ` + problems.join('; '));
        if (byId.has(op.id)) throw new Error(`SmartBar operation ${op.id}: declared twice`);
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
        /** The operations of env's context whose requirements hold for env, in registry order. */
        listAvailable(env) {
            const context = envContext(env);
            return [...byId.values()].filter(op => op.context === context).filter(op => {
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
            const someRequired = params.some(([, schema]) => schema.required === true);
            lines.push(someRequired ? '  params:' : '  params (all optional):');
            for (const [name, schema] of params) {
                const type = schema.type === 'string[]' ? 'list of strings' : schema.type;
                const enumText = Array.isArray(schema.enum) ? ' (one of: ' + schema.enum.join(', ') + ')' : '';
                const need = someRequired ? (schema.required === true ? ', required' : ', optional') : '';
                lines.push(`    - "${name}": ${type}${enumText}${need}, ${schema.description}`);
            }
        }
        return lines.join('\n');
    }).join('\n');
}

/**
 * The operations a validated router output asks for, ready to run: the registry's checks
 * applied, in the order the router gave them (the user's order), with two static rules of the
 * registry, never the model's:
 *   - the runLast operations go after the others (their own order kept);
 *   - a line goes after the lines it depends on (dependsOn), even when the user named it first
 *     or when they are runLast: "make it shorter and create it" runs compose, then
 *     deliver_draft. A stable topological sort: among the lines whose dependencies are placed,
 *     the first non-runLast one in the user's order, else the first runLast one. A cycle keeps
 *     the user's order and drops the dependencies that would point forward.
 * A line's index is its run order, and its dependsOn names earlier lines only.
 *
 *   - an id the registry does not know: dropped, reported ('unknown');
 *   - an operation the user cannot run now (its requirements fail): dropped, reported
 *     ('unavailable');
 *   - a second instance of a single-instance operation: dropped, reported ('duplicate');
 *   - a line sharing its `exclusive` group with an earlier line: dropped, reported ('conflict');
 *   - invalid params: the line is kept in state 'error' (errorType 'params'), the others run.
 *
 * An operation of the other context than `context` is unknown here, as an id the registry does
 * not know: the router of a context is never offered the other's.
 *
 * @param {Array} routed   the router's operations ([{ id, params }])
 * @param {object} [options]
 *   context  'message' (default) or 'compose'
 * @returns {{ lines: Array, reports: Array<{ kind, id }> }}
 *   lines: [{ index, id, params, state, error, errorType, dependsOn, risk, runLast }]
 */
export function planOperations(registry, availableIds, routed, { context = 'message' } = {}) {
    const given = [];
    const reports = [];
    const seen = new Set();
    const groups = new Set();
    for (const item of Array.isArray(routed) ? routed : []) {
        const id = typeof item?.id === 'string' ? item.id.trim() : '';
        const op = registry.get(id);
        if (!op || op.context !== context) {
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
        if (op.exclusive !== undefined && groups.has(op.exclusive)) {
            reports.push({ kind: 'conflict', id: id });
            continue;
        }
        seen.add(id);
        if (op.exclusive !== undefined) groups.add(op.exclusive);
        const checked = validateParams(op, item.params);
        given.push({
            index: given.length,
            id: id,
            params: checked.ok ? checked.params : (item.params ?? {}),
            state: checked.ok ? 'queued' : 'error',
            error: checked.ok ? null : checked.error,
            errorType: checked.ok ? null : 'params',
            dependsOn: [],
            risk: op.risk,
            runLast: op.runLast === true,
        });
    }
    // The dependencies, in the user's order: any other line of the instruction.
    const view = given.map(l => ({ id: l.id, params: l.params, index: l.index }));
    const wants = given.map(line => {
        const deps = registry.get(line.id).dependsOn(view, line.index) || [];
        return new Set(deps.filter(d => Number.isInteger(d) && d >= 0 && d < given.length && d !== line.index));
    });
    // The run order: a stable topological sort over (runLast, the user's order).
    const rank = l => Number(l.runLast) * given.length + l.index;
    const placed = new Set();
    const order = [];
    while (order.length < given.length) {
        const left = given.filter(l => !placed.has(l.index)).sort((a, b) => rank(a) - rank(b));
        let next = left.find(l => [...wants[l.index]].every(d => placed.has(d)));
        if (!next) {
            // A cycle: the first remaining line in the user's order goes, without the
            // dependencies it still waits for (they would point forward).
            next = left.sort((a, b) => a.index - b.index)[0];
            wants[next.index] = new Set([...wants[next.index]].filter(d => placed.has(d)));
        }
        placed.add(next.index);
        order.push(next);
    }
    const runIndex = new Map(order.map((l, i) => [l.index, i]));
    const lines = order.map((l, i) => ({
        ...l,
        index: i,
        dependsOn: [...wants[l.index]].map(d => runIndex.get(d)).sort((a, b) => a - b),
    }));
    return { lines, reports };
}

/**
 * Run the planned lines of one instruction:
 *   - in the user's order, at most `limit` at once (the others wait their turn, first come
 *     first served);
 *   - a line waits for the lines it depends on, and is cancelled if one of them did not end
 *     successfully (SUCCESS_STATES: 'done', or 'drafted' in the chat);
 *   - a 'confirm' line goes to 'pending_confirmation' and waits for confirm(line), WITHOUT
 *     holding a slot: true runs it, false cancels it;
 *   - a runLast line starts only once every other line before it has ended, in whatever state
 *     (planOperations() puts the runLast lines last); it does not hold a slot meanwhile;
 *   - a line already in 'error' (invalid params) is left as it is;
 *   - once `signal` aborts, a line not started yet is cancelled.
 *
 * start(line) runs one line and resolves its outcome { state: 'done' | 'drafted' | 'error' |
 * 'cancelled', ... }; it must
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
        const before = line.runLast === true
            ? lines.filter(l => l.runLast !== true && l.index < line.index).map(l => finals[l.index])
            : [];
        finals[line.index] = (async () => {
            if (line.state === 'error') return line;
            await Promise.all(before);
            const depLines = await Promise.all(deps);
            if (depLines.some(d => !SUCCESS_STATES.includes(d.state)) || aborted()) {
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
                const state = ['done', 'drafted', 'cancelled'].includes(outcome?.state) ? outcome.state : 'error';
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
