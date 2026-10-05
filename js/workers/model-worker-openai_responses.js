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
 * 
 * 
 *  This file contains a modified version of the code from the project at https://github.com/boxabirds/chatgpt-frontend-nobuild
 *  The original code has been released under the Apache License, Version 2.0.
 */

import {
    OpenAI,
    extractUsage
} from '../api/openai_responses.js';
import { readResponseBody } from '../api/api-retry.js';
import { taLogger } from '../mzta-logger.js';
import {
    initUsageEmitter,
    nextUsageMessageId,
    postUsageData
} from './usage-emitter.js';

let openai = null;
let stopStreaming = false;
let i18nStrings = null;
let do_debug = false;
let taLog = null;
// Set only while waiting for the response headers (including the retry
// backoff): Stop aborts the request then. Once streaming has started the
// stopStreaming flag takes over, so a pending reader.read() is never rejected.
let requestAbort = null;

let conversationHistory = [];
let assistantResponseAccumulator = '';
let thinkingAccumulator = '';
let previous_response_id = null;
// previous_response_id as it was before the current turn: a failed turn must not
// leave the next one chained to a response that failed.
let previous_response_id_before_turn = null;
let usageData = null;

// The id the window binds this response's usage badge to. Assigned when the
// request goes out, so the 'usage' message and the answer it belongs to agree.
let usageMessageId = null;

// The usage captured for the last completed request. Accumulated here and nowhere
// else: it is deliberately NOT posted anywhere yet, NOT appended to the response
// text, and NOT pushed into conversationHistory -- the text the callers receive
// must stay byte-identical to what it was before this layer existed.
export function getUsageData() {
    return usageData;
}

// Only the provider, the model and the token counts. Never the request URL or the
// headers: Gemini and some OpenAI-compatible endpoints carry the API key in the
// query string, and a header map carries it outright.
function logUsageData(usage) {
    if (!taLog || !taLog.do_debug || usage === null) return;
    taLog.log("usage data captured: " + JSON.stringify(usage));
}

// Reasoning stream events: reasoning_summary_text.delta carries the summary the
// Responses API exposes for the o-series / gpt-5 models, while some models emit
// reasoning_text.delta instead. Either is forwarded as soon as it appears, with no
// preference gating the detection.
// A third source is handled below: models that do not stream those deltas still
// deliver the summary inside the reasoning item of response.output_item.done. Note
// that the summary is only ever populated when the request asks for it through the
// chatgpt_reasoning_summary preference; without it the item carries just the opaque
// encrypted_content, which cannot be displayed.
const REASONING_DELTA_EVENTS = ['response.reasoning_summary_text.delta', 'response.reasoning_text.delta'];

// A turn that fails once the question was sent (an HTTP or network error,
// response.failed or a cut connection in the middle of the stream): the partial
// answer is dropped and the unanswered question leaves the history, as after an
// abort, so the next turn does not send it twice; the chain goes back to the last
// response that completed.
function abandonTurn() {
    conversationHistory.pop();
    previous_response_id = previous_response_id_before_turn;
    assistantResponseAccumulator = '';
    thinkingAccumulator = '';
}

// The text of an error thrown while reading the stream.
function streamErrorText(error) {
    if (error instanceof TypeError && String(error.message).includes('Error in input stream')) {
        return i18nStrings['error_connection_interrupted'] + ": " + error.message;
    }
    return i18nStrings["chatgpt_api_request_failed"] + ": " + (error && error.message ? error.message : String(error));
}

self.onmessage = async function(event) {
    if (event.data.type === 'init') {
        let config = { stream: true };
        for (const key in event.data) {
            if (key.startsWith('chatgpt_')) {
                if (key.startsWith('chatgpt_web_')) continue; // Exclude chatgpt_web_ prefixed keys
                let newKey = key.replace('chatgpt_', '');
                if (newKey === 'api_key') newKey = 'apiKey';
                config[newKey] = event.data[key];
            }
        }
        openai = new OpenAI(config);
        do_debug = event.data.do_debug;
        i18nStrings = event.data.i18nStrings;
        taLog = new taLogger('model-worker-openai_responses', do_debug);
        initUsageEmitter(event.data);
        previous_response_id = null;
    } else if (event.data.type === 'chatMessage') {
        conversationHistory.push({ role: 'user', content: event.data.message });
        previous_response_id_before_turn = previous_response_id;
        usageData = null;
        usageMessageId = nextUsageMessageId();

        // Only a stored response can be referenced: with chatgpt_store off the API
        // keeps nothing, so previous_response_id is never sent (see fetchResponse())
        // and the whole history must go with every request, or the model would see
        // the new message alone.
        let messagesToSend = conversationHistory;
        if (previous_response_id && openai.store) {
            messagesToSend = [conversationHistory[conversationHistory.length - 1]];
            taLog.log("previous_response_id: " + previous_response_id);
        } else {
            taLog.log("no previous_response_id");
        }

        requestAbort = new AbortController();
        const response = await openai.fetchResponse(messagesToSend, previous_response_id, {
            signal: requestAbort.signal,
            logger: taLog,
            onRetry: (info) => postMessage({ type: 'newRetryAttempt', payload: info }),
        });
        postMessage({ type: 'messageSent' });

        // The body of an HTTP error is read while Stop can still abort it (an abort
        // errors the body), within the time limit of readResponseBody(): a body that
        // never arrives must not leave the turn hanging.
        let errorBodyText = '';
        if (!response.ok && response.is_exception !== true) {
            errorBodyText = await readResponseBody(response);
        }
        const aborted = response.is_aborted === true || requestAbort.signal.aborted;
        requestAbort = null;

        if (aborted) {
            // Stopped before any answer arrived, also while the body of an HTTP
            // error was read: drop the unanswered message, so the next turn does
            // not send it twice.
            stopStreaming = false;
            conversationHistory.pop();
            taLog.log("Request aborted by the user before the response arrived");
            postMessage({ type: 'requestAborted' });
            return;
        }

        if (!response.ok) {
            let error_message = '';
            let errorDetail = '';
            let error_text = '';
            if(response.is_exception === true){
                error_message = response.error;
                // Network-level failure: no status/statusText exist on the returned object,
                // and error_message already carries the provider name.
                error_text = error_message;
            }else{
                try{
                    const errorJSON = JSON.parse(errorBodyText);
                    errorDetail = JSON.stringify(errorJSON);
                    error_message = errorJSON.error.message;
                }catch(e){
                    error_message = response.statusText;
                }
                taLog.log("error_message: " + JSON.stringify(error_message));
                error_text = i18nStrings["chatgpt_api_request_failed"] + ": " + response.status + " " + response.statusText + ", Detail: " + error_message + (errorDetail ? " " + errorDetail : "");
            }
            // rateLimited: a 429 still failing after the retries (rate limit or used-up quota),
            // or a server asking to wait longer than fetchWithRetry() accepts (retryAfterMs,
            // shown to the user): processEmails() stops the whole batch. False on an is_exception.
            const retryAfterMs = Number.isFinite(response.retryAfterMs) ? response.retryAfterMs : null;
            abandonTurn();
            postMessage({ type: 'error', payload: error_text, rateLimited: response.status === 429 || retryAfterMs !== null, retryAfterMs: retryAfterMs });
            throw new Error("[ThunderAI] OpenAI ChatGPT API request failed: " + error_text);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';
        let streamError = false;

        try {
            while (true) {
                if (stopStreaming) {
                    stopStreaming = false;
                    reader.cancel();
                    taLog.log("AI full reasoning [STOPPED]: " + thinkingAccumulator);
                    taLog.log("AI full response [STOPPED]: " + assistantResponseAccumulator);
                    conversationHistory.push({ role: 'assistant', content: assistantResponseAccumulator });
                    assistantResponseAccumulator = '';
                    // Separate from tokensDone and free of any response text: see usage-emitter.js.
                    postUsageData(usageData, usageMessageId);
                    postMessage({ type: 'tokensDone', payload: { thinking: thinkingAccumulator } });
                    thinkingAccumulator = '';
                    break;
                }
                const { done, value } = await reader.read();
                if (done) {
                    taLog.log("AI full reasoning: " + thinkingAccumulator);
                    taLog.log("AI full response: " + assistantResponseAccumulator);
                    conversationHistory.push({ role: 'assistant', content: assistantResponseAccumulator });
                    assistantResponseAccumulator = '';
                    // Separate from tokensDone and free of any response text: see usage-emitter.js.
                    postUsageData(usageData, usageMessageId);
                    postMessage({ type: 'tokensDone', payload: { thinking: thinkingAccumulator } });
                    thinkingAccumulator = '';
                    break;
                }
                // lots of low-level OpenAI response parsing stuff
                // stream: true keeps a multi-byte character split across two chunks
                // for the next call instead of replacing it with U+FFFD.
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                // No per-chunk dump of `buffer`: taLog.log() only gates the console call,
                // so the whole unconsumed buffer would be re-concatenated on every SSE
                // chunk even with debug off. The per-line log below covers it, guarded.
                const lines = buffer.split("\n");
                buffer = lines.pop();
                let parsedLines = [];
                try{
                    parsedLines = lines
                        .map((line) => line.trim())
                        .filter((line) => line.startsWith("data:"))
                        .map((line) => line.replace(/^data: /, "").trim()) // Remove the "data: " prefix
                        .filter((line) => line !== "" && line !== "[DONE]") // Remove empty lines and "[DONE]"
                        .map((line) => {
                             try {
                                // Guarded at the call site: taLog.log() gates only the console
                                // call, so an unguarded JSON.stringify() would run per SSE line
                                // even with debug off.
                                if (taLog.do_debug) taLog.log("line: " + JSON.stringify(line));
                                return JSON.parse(line);
                            } catch (e) {
                                taLog.warn("JSON parse warning, skipped line: " + line + " - " + e.message);
                                return null;
                            }
                        })
                        .filter((parsed) => parsed !== null);
                }catch(e){
                    taLog.error("Error parsing lines: " + e);
                }
    
                for (const parsedLine of parsedLines) {
                    if (parsedLine.type === 'response.created' && parsedLine.response && parsedLine.response.id){
                        previous_response_id = parsedLine.response.id;
                    } else if (parsedLine.type === 'response.output_text.delta' && parsedLine.delta) {
                        assistantResponseAccumulator += parsedLine.delta;
                        postMessage({ type: 'newToken', payload: { token: parsedLine.delta } });
                    } else if (REASONING_DELTA_EVENTS.includes(parsedLine.type) && typeof parsedLine.delta === 'string' && parsedLine.delta !== '') {
                        thinkingAccumulator += parsedLine.delta;
                        postMessage({ type: 'newThinkingToken', payload: { token: parsedLine.delta } });
                    } else if (parsedLine.type === 'response.output_item.done' && parsedLine.item && parsedLine.item.type === 'reasoning' && thinkingAccumulator === '') {
                        // Fallback for models that never stream the reasoning deltas: the whole
                        // summary shows up at once here. Skipped when the accumulator already
                        // holds streamed text, so the reasoning is never emitted twice.
                        const summary_text = Array.isArray(parsedLine.item.summary)
                            ? parsedLine.item.summary.map((part) => (part && typeof part.text === 'string') ? part.text : '').join('')
                            : '';
                        if (summary_text !== '') {
                            thinkingAccumulator += summary_text;
                            postMessage({ type: 'newThinkingToken', payload: { token: summary_text } });
                        }
                    } else if (parsedLine.type === 'response.completed') {
                        // The usage only ever arrives here, on the final event, under
                        // event.response.usage.
                        const usage = extractUsage(parsedLine);
                        if (usage !== null) {
                            usageData = usage;
                            logUsageData(usageData);
                        }
                    } else if (parsedLine.type === 'response.failed' && parsedLine.response && parsedLine.response.error) {
                        const error = parsedLine.response.error;
                        const errorMessage = error.message || JSON.stringify(error);
                        taLog.error("response.failed: " + JSON.stringify(error));
                        reader.cancel();
                        abandonTurn();
                        postMessage({ type: 'error', payload: i18nStrings["chatgpt_api_request_failed"] + ": " + errorMessage });
                        streamError = true;
                        break;
                    }
                }
                if (streamError) break;
            }
        } catch (error) {
            // The connection broke while reading: report it, never end the turn silently.
            console.error('[ThunderAI] OpenAI stream interrupted:', error);
            abandonTurn();
            postMessage({ type: 'error', payload: streamErrorText(error) });
        }
    } else if (event.data.type === 'stop') {
        stopStreaming = true;
        if (requestAbort) requestAbort.abort();
    }
};
