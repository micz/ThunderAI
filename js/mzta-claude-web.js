/* ThunderAI — Claude Web page adapter, GPL-3.0-or-later. */

(() => {
    if (window.top !== window || window.mztaClaudeWebLoaded) return;
    window.mztaClaudeWebLoaded = true;

    const COMPOSERS = ['.ProseMirror[contenteditable="true"]', '[contenteditable="true"][role="textbox"]', 'main textarea'];
    const RESPONSES = ['[data-testid="assistant-message"]', '[data-message-author-role="assistant"]', '.font-claude-response'];
    const STOP = '[data-testid="stop-button"], [data-testid="stop-response"], [data-is-streaming="true"]';
    const POLL_MS = 250;
    const REPLY_TIMEOUT_MS = 240000;
    const t = key => browser.i18n.getMessage(key);
    let payload, panel, status, sendButton, useButton, selectedButton, review, replyType;
    let timer, startedAt, submitted = false, sending = false;
    let baseline = new Set(), responseText = '', changedAt = 0;

    function visible(el) {
        return el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    }

    function composer() {
        for (const selector of COMPOSERS) {
            for (const el of document.querySelectorAll(selector)) {
                if (visible(el) && !panel?.contains(el)) return el;
            }
        }
        return null;
    }

    function responses() {
        for (const selector of RESPONSES) {
            const matches = [...document.querySelectorAll(selector)].filter(el => visible(el) && !el.closest('details') && !panel?.contains(el));
            if (matches.length) return matches;
        }
        return [];
    }

    function latestResponse() {
        return responses().filter(el => !baseline.has(el)).at(-1);
    }

    function selectionText() {
        const selection = window.getSelection();
        if (!selection?.rangeCount || selection.isCollapsed) return '';
        const range = selection.getRangeAt(0);
        const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
            ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
        if (!ancestor || panel.contains(ancestor) || ancestor.closest('[contenteditable], textarea, button, nav')) return '';
        const response = latestResponse();
        // Prefer the new assistant turn; selection in main is a manual fallback
        // when Claude changes the response markup.
        if (response ? !response.contains(ancestor) : !ancestor.closest('main')) return '';
        return selection.toString().trim();
    }

    function showStatus(key) {
        status.textContent = t(key);
    }

    function button(key, handler) {
        const el = document.createElement('button');
        el.type = 'button';
        el.textContent = t(key);
        el.addEventListener('click', handler);
        return el;
    }

    function stopWatching() {
        clearInterval(timer);
        timer = null;
    }

    function watchReply() {
        stopWatching();
        startedAt = Date.now();
        timer = setInterval(() => {
            const el = latestResponse();
        const text = el?.innerText?.trim() || '';
            if (text !== responseText) {
                responseText = text;
                changedAt = Date.now();
                useButton.disabled = true;
            }
            const streaming = [...document.querySelectorAll(STOP)].some(visible);
            if (text && !streaming && Date.now() - changedAt >= 2500) {
                useButton.disabled = false;
                showStatus('claude_web_ready');
            } else {
                useButton.disabled = true;
            }
            selectedButton.disabled = !selectionText();
            if (Date.now() - startedAt >= REPLY_TIMEOUT_MS) {
                stopWatching();
                useButton.disabled = true;
                showStatus('claude_web_timeout');
            }
        }, POLL_MS);
    }

    function promptText() {
        let prompt = payload.prompt;
        let replaced = false;
        const values = [];
        for (const input of panel.querySelectorAll('[data-placeholder]')) {
            const value = input.value;
            values.push(value);
            const placeholder = input.dataset.placeholder;
            if (prompt.includes(placeholder)) {
                prompt = prompt.split(placeholder).join(value);
                replaced = true;
            }
        }
        if (!replaced && values.length) prompt += '\n' + values.join('\n');
        return prompt;
    }

    async function sendPrompt() {
        if (sending || submitted) return;
        const input = composer();
        if (!input) {
            showStatus('claude_web_waiting_login');
            return;
        }
        // Never replace a message the user has already typed into Claude.
        if ((input.value ?? input.innerText).trim()) {
            showStatus('claude_web_send_failed');
            return;
        }
        sending = true;
        sendButton.disabled = true;
        showStatus('claude_web_sending');
        try {
            baseline = new Set(responses());
            const text = promptText();
            input.focus();
            if (input instanceof HTMLTextAreaElement) {
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, text);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                // execCommand dispatches the input events ProseMirror needs;
                // setting innerHTML would leave its editor state unchanged.
                document.execCommand('selectAll', false);
                if (!document.execCommand('insertText', false, text)) throw new Error('Claude composer rejected input');
            }
            await new Promise(resolve => setTimeout(resolve, 200));
            const form = input.closest('form');
            let container = form || input.parentElement;
            let submit;
            for (let i = 0; container && i < 6; i++, container = container.parentElement) {
                submit = [...container.querySelectorAll('button[type="submit"], button[data-testid="send-button"]')].find(el => visible(el) && !el.disabled);
                if (submit) break;
            }
            // Record before clicking. A page reload during submission cannot
            // duplicate a generation (or charge the user's account twice).
            if (!await browser.runtime.sendMessage({ command: 'claude_web_mark_submitted' })) throw new Error('Claude call expired');
            submitted = true;
            if (submit) submit.click();
            showStatus(submit ? 'claude_web_waiting_reply' : 'claude_web_send_uncertain');
            watchReply();
        } catch (error) {
            console.error('[ThunderAI | Claude Web] Could not send prompt:', error);
            showStatus('claude_web_send_failed');
            sendButton.disabled = submitted;
        } finally {
            sending = false;
        }
    }

    function openReview(text) {
        if (!text) {
            showStatus('claude_web_no_response');
            return;
        }
        review.replaceChildren();
        const label = document.createElement('label');
        label.textContent = t('claude_web_review_hint');
        const editor = document.createElement('textarea');
        editor.id = 'mzta-claude-review-text';
        label.htmlFor = editor.id;
        editor.value = text;
        editor.rows = 8;
        const apply = button('claude_web_confirm_response', async () => {
            if (!editor.value.trim()) return;
            const current = latestResponse()?.innerText?.trim();
            if (current && current !== responseAtReview) {
                showStatus('claude_web_response_changed');
                review.hidden = true;
                return;
            }
            apply.disabled = true;
            try {
                const ok = await browser.runtime.sendMessage({ command: 'claude_web_apply', text: editor.value, replyType: replyType?.value });
                if (!ok) throw new Error('Claude call expired');
                await browser.runtime.sendMessage({ command: 'claude_web_close' });
            } catch (error) {
                console.error('[ThunderAI | Claude Web] Could not apply response:', error);
                showStatus('claude_web_start_failed');
                apply.disabled = false;
            }
        });
        const responseAtReview = latestResponse()?.innerText?.trim();
        review.append(label, editor, apply, button('claude_web_cancel', () => { review.hidden = true; }));
        review.hidden = false;
        editor.focus();
    }

    function createPanel() {
        panel = document.createElement('section');
        panel.id = 'mzta-claude-panel';
        panel.setAttribute('aria-label', 'ThunderAI');
        const title = document.createElement('strong');
        title.textContent = 'ThunderAI · ' + payload.promptName;
        status = document.createElement('p');
        status.setAttribute('role', 'status');
        sendButton = button('claude_web_send_prompt', sendPrompt);
        useButton = button('claude_web_review_response', () => openReview(latestResponse()?.innerText?.trim()));
        useButton.disabled = true;
        selectedButton = button('chatgpt_win_get_answer', () => openReview(selectionText()));
        // Keep the page selection when clicking ThunderAI's controls.
        selectedButton.addEventListener('mousedown', event => event.preventDefault());
        selectedButton.disabled = true;
        review = document.createElement('div');
        review.hidden = true;
        const close = button('chatgpt_win_close', () => browser.runtime.sendMessage({ command: 'claude_web_close' }).catch(error => console.error('[ThunderAI | Claude Web] Close failed:', error)));
        panel.append(title, status);
        const fields = Array.isArray(payload.promptInfo?.custom_text_array) ? payload.promptInfo.custom_text_array : [];
        if (payload.doCustomText) {
            for (const field of fields.length ? fields : [{ placeholder: '{%additional_text%}' }]) {
                const label = document.createElement('label');
                label.textContent = t('chatgpt_win_custom_text') + (field.info ? ' (' + field.info + ')' : '');
                const input = document.createElement('textarea');
                input.dataset.placeholder = field.placeholder || '{%additional_text%}';
                input.rows = 2;
                label.append(input);
                panel.append(label);
            }
        }
        panel.append(sendButton);
        if (payload.action !== '0') {
            panel.append(useButton, selectedButton);
            if (payload.action === '1' && payload.mailMessageId !== -1) {
                replyType = document.createElement('select');
                replyType.setAttribute('aria-label', t('chatgpt_win_change_reply_type'));
                for (const [value, key] of [['reply_sender', 'prefs_OptionText_reply_sender'], ['reply_all', 'prefs_OptionText_reply_all']]) {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = t(key);
                    replyType.append(option);
                }
                replyType.value = payload.replyType === 'reply_sender' ? 'reply_sender' : 'reply_all';
                panel.append(replyType);
            }
            const hint = document.createElement('p');
            hint.textContent = t('claude_web_select_response');
            panel.append(hint);
        }
        panel.append(close, review);
        const style = document.createElement('style');
        style.textContent = `
            #mzta-claude-panel { position:fixed; top:12px; right:12px; z-index:2147483647; width:min(440px,calc(100vw - 24px)); max-height:55vh; overflow:auto; padding:16px; border:1px solid #888; border-radius:10px; box-shadow:0 4px 20px #0003; color:#222; background:#fff; font:14px/1.4 system-ui,sans-serif; }
            #mzta-claude-panel p { margin:8px 0; }
            #mzta-claude-panel button, #mzta-claude-panel select { font:inherit; padding:6px 10px; margin:4px; border:1px solid #888; border-radius:6px; background:#f4f4f4; color:inherit; cursor:pointer; }
            #mzta-claude-panel button:disabled { opacity:.5; cursor:default; }
            #mzta-claude-panel label { display:block; margin:8px 0; }
            #mzta-claude-panel textarea { display:block; box-sizing:border-box; width:100%; margin:6px 0; padding:8px; font:inherit; color:inherit; background:inherit; border:1px solid #888; resize:vertical; }
            @media (prefers-color-scheme:dark) { #mzta-claude-panel { color:#eee; background:#242424; } #mzta-claude-panel button, #mzta-claude-panel select { background:#333; } }
        `;
        document.head.append(style);
        document.body.append(panel);
        document.addEventListener('selectionchange', () => { selectedButton.disabled = !submitted || !selectionText(); });
        // React may replace the body. Reattach the same controls, preserving input.
        const observer = new MutationObserver(() => {
            if (!panel.isConnected && document.body) document.body.append(panel);
            if (!style.isConnected && document.head) document.head.append(style);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        window.addEventListener('pagehide', () => { stopWatching(); observer.disconnect(); }, { once: true });
    }

    async function start() {
        try {
            payload = await browser.runtime.sendMessage({ command: 'claude_web_get_prompt', callId: new URL(location.href).searchParams.get('thunderai_call') });
            if (!payload) return;
            createPanel();
            submitted = payload.submitted;
            if (submitted) {
                sendButton.disabled = true;
                showStatus('claude_web_select_response');
                return;
            }
            showStatus('claude_web_waiting_login');
            const waitStart = Date.now();
            timer = setInterval(() => {
                if (composer()) {
                    stopWatching();
                    if (!payload.doCustomText && ['/new', '/'].includes(location.pathname)) {
                        setTimeout(sendPrompt, Math.min(15000, Math.max(0, Number(payload.loadWaitTime) || 0)));
                    }
                } else if (Date.now() - waitStart > 15000) {
                    stopWatching();
                }
            }, POLL_MS);
        } catch (error) {
            console.error('[ThunderAI | Claude Web] Initialization failed:', error);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
