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
 *  The chat of the SmartBar (claude-spec/10-smartbar.md "Chat"): the conversation of a session
 *  as the prompts carry it, and the prompt of the free conversation (special prompt
 *  prompt_smartbar_chat), the call made for a message no operation covers.
 *
 *  The free-conversation prompt is, in this order:
 *    1. the editable text of the special prompt (no JSON section: the answer is free text);
 *    2. the message, built by the add-on and not editable:
 *         the email between delimiters, declared as data;
 *         the conversation so far, declared as data;
 *         a model answer that could not be read ("Open in chat" from a json error), as data;
 *         the user's new message;
 *         the language rule.
 *
 *  Pure: no browser API, so level 1 loads it directly.
 */

import {
    CONVERSATION_HEADER,
    RAW_CONTEXT_HEADER,
    dataSection,
    emailSection
} from './mzta-smartbar-execute.js';
import { capText } from './mzta-smartbar-router.js';

/** The longest conversation a prompt carries (characters): the oldest turns are left out first. */
export const CONVERSATION_CAP = 12000;
/** The longest unreadable model answer given as context (characters). */
export const RAW_CONTEXT_CAP = 8000;
/** The mark of a conversation whose oldest turns were left out. */
export const CONVERSATION_CUT_MARK = '[earlier messages left out]';

/** The language rule of the free conversation. */
export const CHAT_LANGUAGE_RULE = 'Answer in the language of the user\'s new message.';

/**
 * The turns of a session, oldest first, from its records (oldest first): for each record the
 * user's message, then what the add-on answered: the free answer, the drafts its compose
 * operation wrote, the state of the other operations. The prompts receive it as data.
 * @returns {Array<{ role: 'user' | 'assistant', text: string }>}
 */
export function conversationTurns(records) {
    const turns = [];
    for (const record of Array.isArray(records) ? records : []) {
        if (!record) continue;
        const instruction = String(record.instruction ?? '').trim();
        if (instruction !== '') turns.push({ role: 'user', text: instruction });
        const parts = [];
        if (typeof record.answer === 'string' && record.answer.trim() !== '') parts.push(record.answer.trim());
        const others = [];
        for (const op of record.operations || []) {
            const result = op?.result;
            if (op?.id === 'compose' && result && typeof result === 'object' && typeof result.body === 'string' && result.body !== '') {
                const head = 'Draft (' + (result.type || op.params?.type || 'reply') + ')' + (op.state === 'done' ? ', email created' : '') + ':';
                const subject = result.subject ? 'Subject: ' + result.subject + '\n' : '';
                parts.push(head + '\n' + subject + result.body);
            } else if (op?.id) {
                others.push(op.id + (op.id === 'compose' && op.params?.type ? ' (' + op.params.type + ')' : '') + ': ' + op.state);
            }
        }
        if (others.length > 0) parts.push('Operations: ' + others.join(', '));
        if (parts.length > 0) turns.push({ role: 'assistant', text: parts.join('\n\n') });
    }
    return turns;
}

/**
 * The conversation as one text ("User: ..." / "Assistant: ..."), at most `cap` characters: the
 * oldest turns are left out first (CONVERSATION_CUT_MARK says so), and a single turn longer
 * than the cap keeps its end. '' for no turn.
 */
export function renderConversation(turns, cap = CONVERSATION_CAP) {
    const blocks = (Array.isArray(turns) ? turns : [])
        .filter(t => t && typeof t.text === 'string' && t.text.trim() !== '')
        .map(t => (t.role === 'user' ? 'User: ' : 'Assistant: ') + t.text.trim());
    if (blocks.length === 0) return '';
    const max = Number.isInteger(cap) && cap > 0 ? cap : Infinity;
    let kept = blocks;
    let cut = false;
    while (kept.length > 1 && kept.join('\n\n').length > max) {
        kept = kept.slice(1);
        cut = true;
    }
    let text = kept.join('\n\n');
    if (text.length > max) {
        text = text.slice(text.length - max);
        cut = true;
    }
    return cut ? CONVERSATION_CUT_MARK + '\n\n' + text : text;
}

/**
 * The whole prompt of the free conversation.
 * @param {object} o
 *   text          the editable text of prompt_smartbar_chat
 *   email         { subject, from, to: [], cc: [], date, text } (text already trimmed)
 *   conversation  the conversation so far (renderConversation()), '' for none
 *   rawContext    a model answer that could not be read, '' for none (capped here)
 *   message       the user's new message
 */
export function buildChatPrompt({ text, email = {}, conversation = '', rawContext = '', message = '' }) {
    const sections = [String(text ?? '').trim(), emailSection(email)];
    if (String(conversation ?? '').trim() !== '') sections.push(dataSection(CONVERSATION_HEADER, String(conversation).trim()));
    const raw = capText(String(rawContext ?? '').trim(), RAW_CONTEXT_CAP);
    if (raw) sections.push(dataSection(RAW_CONTEXT_HEADER, raw));
    sections.push('The user\'s new message:\n' + String(message ?? ''));
    sections.push('Language: ' + CHAT_LANGUAGE_RULE);
    return sections.filter(s => s !== '').join('\n\n');
}
