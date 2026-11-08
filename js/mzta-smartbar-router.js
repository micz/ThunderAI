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
 *  The Smart bar router (claude-spec/10-smartbar.md "Router"): the prompt the add-on builds for
 *  the special prompt prompt_smartbar_router, and the checks of its answer.
 *
 *  The router NEVER receives the email body: a prompt injection in the mail must not be able to
 *  choose the operations or their parameters. It gets the instruction, the available operations,
 *  and metadata only (subject, sender, participant names, the tags, whether text is selected).
 *
 *  The prompt is, in this order:
 *    1. the editable text of the special prompt, with its variables substituted
 *       (ROUTER_VARIABLES; a variable the text lacks has its content appended instead, so the
 *       router always sees the operations);
 *    2. the JSON section (ROUTER_JSON_SECTION), LOCKED: appended by the add-on, never part of the
 *       editable text;
 *    3. the user block: the instruction and the metadata, built by the add-on, not editable.
 *
 *  Pure apart from extractJsonObject(): no browser API, so level 1 loads it directly.
 */

import { extractJsonObject } from './mzta-utils.js';

/** The variables the editable router text holds, substituted by buildRouterPrompt(). */
export const ROUTER_VARIABLES = Object.freeze(['{OPERATIONS}', '{PLACEHOLDERS}', '{LANGUAGE_RULE}']);

/** The fixed rule {LANGUAGE_RULE} stands for. */
export const ROUTER_LANGUAGE_RULE =
    'Write the values of free-text parameters (a tag name, a language) as the user wrote them, ' +
    'in the language of the instruction. When the user asks for a translation without naming a ' +
    'language, give no "language" parameter: the language configured by the user is used.';

/** The locked JSON format section, appended after the editable text. */
export const ROUTER_JSON_SECTION = [
    'Reply with one JSON object and nothing else: no explanation, no code fence. Its format:',
    '{"operations": [{"id": "<operation id>", "params": {}}], "context": [], "unrecognized": ""}',
    '- "operations": the operations the instruction asks for, in the order the user expressed them; [] when none.',
    '- "params": only the parameters listed for that operation; {} when none applies.',
    '- "context": the placeholder ids listed above whose information the instruction needs; [] when none.',
    '- "unrecognized": the part of the instruction no operation covers, word for word; "" when everything is covered.',
].join('\n');

/** Appended to the prompt for the one correction attempt after an answer that is not JSON. */
export const ROUTER_CORRECTION =
    'Your previous reply was not a valid JSON object. Reply with the JSON object only, in the format above.';

/** The placeholder ids the router may never pick (claude-spec/10-smartbar.md "Placeholders"). */
export const ROUTER_EXCLUDED_PLACEHOLDERS = Object.freeze(['empty', 'additional_text', 'mail_typed_text']);

/** The longest raw answer kept in a record (claude-spec/10-smartbar.md "Storage"). */
export const RAW_RESPONSE_CAP = 8000;

/** An error of the router's answer: errorType 'json', with the raw answer (capped). */
export class RouterJsonError extends Error {
    constructor(message, rawResponse) {
        super(message);
        this.name = 'RouterJsonError';
        this.errorType = 'json';
        this.rawResponse = capText(rawResponse, RAW_RESPONSE_CAP);
    }
}

/** A text cut to `max` characters (null stays null). */
export function capText(text, max) {
    if (text === null || text === undefined) return null;
    const s = String(text);
    return s.length > max ? s.slice(0, max) : s;
}

/**
 * The placeholders the router may pick: the built-in ones of a reading context, but the three
 * excluded ids and the composing-only ones. `placeholders` is the defaultPlaceholders list
 * ({ id, name, type, is_dynamic }), `describe(ph)` gives each one's description.
 * @returns {Array<{ id, description, dynamic }>}
 */
export function routerPlaceholderAllowList(placeholders, describe = ph => ph.name) {
    return (placeholders || [])
        .filter(ph => ph && typeof ph.id === 'string')
        .filter(ph => !ROUTER_EXCLUDED_PLACEHOLDERS.includes(ph.id))
        .filter(ph => String(ph.type ?? '0') !== '2')
        .map(ph => ({ id: ph.id, description: String(describe(ph) ?? ''), dynamic: ph.is_dynamic === '1' }));
}

/** The allow list as the router prompt lists it. */
export function describePlaceholders(allowList) {
    return allowList.map(ph => `- ${ph.id}${ph.dynamic ? ' (takes a parameter: ' + ph.id + ':<value>)' : ''}: ${ph.description}`).join('\n');
}

/** The display names of a list of addresses ("Name <a@b>"): names only, never an address. */
export function participantNames(addresses) {
    const out = [];
    for (const raw of Array.isArray(addresses) ? addresses : (addresses ? [addresses] : [])) {
        if (typeof raw !== 'string') continue;
        const m = raw.match(/^\s*"?([^"<]*?)"?\s*<[^>]*>\s*$/);
        const name = m ? m[1].trim() : '';
        if (name !== '' && !name.includes('@') && !out.includes(name)) out.push(name);
    }
    return out;
}

/**
 * The whole router prompt.
 * @param {object} o
 *   text          the editable text of prompt_smartbar_router
 *   operations    the description of the available operations (describeOperations())
 *   placeholders  the description of the allow list (describePlaceholders())
 *   instruction   what the user typed
 *   metadata      { subject, author, participants: [names], tags: [names], hasSelection,
 *                 draftExists?, draftType? } (the last two from the chat only)
 */
export function buildRouterPrompt({ text, operations, placeholders, instruction, metadata = {} }) {
    const values = {
        '{OPERATIONS}': operations,
        '{PLACEHOLDERS}': placeholders,
        '{LANGUAGE_RULE}': ROUTER_LANGUAGE_RULE,
    };
    let body = String(text ?? '');
    const missing = [];
    for (const variable of ROUTER_VARIABLES) {
        if (body.includes(variable)) body = body.split(variable).join(values[variable]);
        else missing.push(values[variable]);
    }
    if (missing.length > 0) body += '\n\n' + missing.join('\n\n');

    const meta = [];
    meta.push('Subject: ' + (metadata.subject || ''));
    const sender = participantNames([metadata.author]);
    meta.push('From: ' + (sender[0] || ''));
    meta.push('Participants: ' + (metadata.participants || []).join(', '));
    meta.push('Existing tags: ' + (metadata.tags || []).join(', '));
    meta.push('Text selected in the email: ' + (metadata.hasSelection ? 'yes' : 'no'));
    if (metadata.hasSelection) {
        meta.push('The selected text is always given to the later steps (selected_text): do not list it in "context".');
    }
    // The chat only (draft_exists / draft_type): whether the conversation holds a draft email
    // not created yet. A change asked for it is a compose operation of its type; approving it is
    // deliver_draft (offered only then).
    if (typeof metadata.draftExists === 'boolean') {
        meta.push('Draft email in this conversation (draft_exists): ' + (metadata.draftExists ? 'yes' : 'no'));
        if (metadata.draftExists) {
            meta.push('Type of the draft (draft_type): ' + String(metadata.draftType || ''));
            meta.push('A change asked for the draft is a "compose" operation with the type of the draft.');
        }
    }

    return [
        body.trim(),
        ROUTER_JSON_SECTION,
        'Instruction:\n' + String(instruction ?? ''),
        'Email information (the email body is not given to you):\n' + meta.join('\n'),
    ].join('\n\n');
}

/**
 * The router's answer as an object. The reasoning has already been stripped by the special
 * command (stripThinkTags(), as for every special command). Throws RouterJsonError when no JSON
 * object can be read from it.
 */
export function parseRouterResponse(raw) {
    let parsed;
    try {
        parsed = extractJsonObject(String(raw ?? ''));
    } catch (e) {
        throw new RouterJsonError('The answer is not a JSON object: ' + (e?.message || e), raw);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new RouterJsonError('The answer is not a JSON object.', raw);
    }
    return parsed;
}

/** The {%…%} placeholder ids typed in an instruction (the part before a ':' for a dynamic one kept whole). */
export function typedPlaceholders(instruction) {
    const out = [];
    const re = /{%\s*(.*?)\s*%}/g;
    let m;
    while ((m = re.exec(String(instruction ?? ''))) !== null) {
        const key = m[1].replace(/\s*:\s*/, ':');
        if (key !== '' && !out.includes(key)) out.push(key);
    }
    return out;
}

/**
 * The context of an instruction: the ids the router picked that the allow list holds (a dynamic
 * one with its parameter), then selected_text when text is selected (a fixed rule, no AI), then
 * the placeholders the user typed (always honored, if they exist at all).
 *   knownIds  every placeholder id that exists (built-in and custom), for the typed ones
 */
export function resolveContext(routed, allowList, { hasSelection = false, instruction = '', knownIds = [] } = {}) {
    const allowed = new Map(allowList.map(ph => [ph.id, ph]));
    const out = [];
    const add = id => { if (!out.includes(id)) out.push(id); };
    for (const item of Array.isArray(routed) ? routed : []) {
        if (typeof item !== 'string') continue;
        const key = item.trim().replace(/^{%\s*|\s*%}$/g, '');
        const [id, ...rest] = key.split(':');
        const ph = allowed.get(id.trim());
        if (!ph) continue;
        if (rest.length > 0) {
            if (ph.dynamic) add(id.trim() + ':' + rest.join(':').trim());
        } else {
            add(ph.id);
        }
    }
    if (hasSelection) add('selected_text');
    for (const key of typedPlaceholders(instruction)) {
        if (knownIds.includes(key.split(':')[0])) add(key);
    }
    return out;
}

/**
 * Read a router answer: { operations (raw, for planOperations()), context, unrecognized }.
 * "operations" missing or not a list counts as none; "unrecognized" '' is null.
 */
export function readRouterOutput(parsed, allowList, options = {}) {
    const unrecognized = typeof parsed.unrecognized === 'string' && parsed.unrecognized.trim() !== ''
        ? parsed.unrecognized.trim() : null;
    return {
        operations: Array.isArray(parsed.operations) ? parsed.operations : [],
        context: resolveContext(parsed.context, allowList, options),
        unrecognized: unrecognized,
    };
}

/**
 * Ask a Smart bar special command for a JSON object, with one correction attempt: `send(prompt)`
 * resolves the raw answer of one special command call. An answer that is not a JSON object (or
 * that `check(parsed, raw)` refuses by throwing a RouterJsonError) gets the prompt again with
 * `correction` appended; a second failure rejects with RouterJsonError (errorType 'json', the
 * second raw answer kept). Errors of `send` itself are passed on unchanged. Shared by the router
 * and the generative operations (js/mzta-smartbar-execute.js).
 * @returns {Promise<{ parsed: object, raw: string, attempts: number }>}
 */
export async function askJsonObject(prompt, send, { correction = ROUTER_CORRECTION, check = () => {} } = {}) {
    const read = raw => {
        const parsed = parseRouterResponse(raw);
        check(parsed, raw);
        return parsed;
    };
    const first = await send(prompt);
    try {
        return { parsed: read(first), raw: first, attempts: 1 };
    } catch (e) {
        if (!(e instanceof RouterJsonError)) throw e;
    }
    const second = await send(prompt + '\n\n' + correction);
    return { parsed: read(second), raw: second, attempts: 2 };
}

/** Ask the router, with one correction attempt (askJsonObject() with ROUTER_CORRECTION). */
export async function askRouter(prompt, send) {
    return askJsonObject(prompt, send, { correction: ROUTER_CORRECTION });
}
