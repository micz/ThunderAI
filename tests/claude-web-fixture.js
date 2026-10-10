const results = document.getElementById('results');
const frame = document.querySelector('iframe');
const source = await (await fetch('../js/mzta-claude-web.js')).text();
const messages = await (await fetch('../_locales/en/messages.json')).json();
let passed = 0, failed = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function fixture(overrides = {}, html = '<form><div class="ProseMirror" contenteditable="true" role="textbox"></div><button type="submit">Send</button></form>') {
    frame.srcdoc = '<!doctype html><html><head></head><body><main>' + html + '</main></body></html>';
    await new Promise(resolve => frame.onload = resolve);
    const win = frame.contentWindow;
    const applied = [];
    let marked = 0;
    // The adapter's top-frame guard is intentional. This test removes only that
    // guard because each independent fixture lives inside an iframe.
    win.browser = {
        i18n: { getMessage: key => messages[key]?.message || 'MISSING:' + key },
        runtime: { sendMessage: async message => {
            if (message.command === 'claude_web_get_prompt') return { prompt: 'Test email: "Hello"', action: '2', tabId: 10, mailMessageId: -1, promptName: 'Test', doCustomText: false, loadWaitTime: 0, ...overrides };
            if (message.command === 'claude_web_mark_submitted') { marked++; return true; }
            if (message.command === 'claude_web_apply') { applied.push(message); return true; }
            return true;
        } }
    };
    win.document.querySelector('form')?.addEventListener('submit', event => {
        event.preventDefault();
        const composer = win.document.querySelector('[contenteditable], main textarea');
        composer.value !== undefined ? composer.value = '' : composer.replaceChildren();
        const response = win.document.createElement('div');
        response.className = 'font-claude-response';
        response.innerText = 'A rewritten test email.';
        win.document.querySelector('main').append(response);
    });
    win.eval(source.replace('window.top !== window || ', ''));
    await wait(100);
    return { win, doc: win.document, applied, marked: () => marked };
}

function control(doc, key) {
    return [...doc.querySelectorAll('#mzta-claude-panel button')].find(el => el.textContent === messages[key].message);
}

async function check(name, run) {
    const li = document.createElement('li');
    results.append(li);
    try { await run(); passed++; li.className = 'pass'; li.textContent = 'PASS: ' + name; }
    catch (error) { failed++; li.className = 'fail'; li.textContent = 'FAIL: ' + name + ': ' + error.message; }
}

await check('prompt send, response review, and user-edited apply', async () => {
    const f = await fixture();
    control(f.doc, 'claude_web_send_prompt').click();
    await wait(3300);
    assert(f.marked() === 1, 'Expected exactly one submission');
    const review = control(f.doc, 'claude_web_review_response');
    assert(!review.disabled, 'Response review disabled');
    review.click();
    assert(f.doc.getElementById('mzta-claude-review-text').value === 'A rewritten test email.', 'Wrong response');
    f.doc.getElementById('mzta-claude-review-text').value = 'Reviewed by the user.';
    control(f.doc, 'claude_web_confirm_response').click();
    await wait(20);
    assert(f.applied[0].text === 'Reviewed by the user.', 'Edits not preserved');
});

await check('login page holds the prompt without submission', async () => {
    const f = await fixture({}, '<h1>Sign in</h1>');
    control(f.doc, 'claude_web_send_prompt').click();
    await wait(300);
    assert(f.marked() === 0, 'Submitted without composer');
    assert(f.doc.querySelector('[role=status]').textContent === messages.claude_web_waiting_login.message, 'Missing login status');
});

await check('custom placeholders replace every occurrence literally', async () => {
    const f = await fixture({ doCustomText: true, prompt: '{%custom_text_x%} / {%custom_text_x%}', promptInfo: { custom_text_array: [{ placeholder: '{%custom_text_x%}', info: 'Tone' }] } });
    f.doc.querySelector('[data-placeholder]').value = '$& formal';
    let sent = '';
    f.doc.querySelector('form').addEventListener('submit', () => { sent = f.doc.querySelector('[contenteditable]').innerText; }, true);
    control(f.doc, 'claude_web_send_prompt').click();
    await wait(500);
    assert(sent === '$& formal / $& formal', 'Placeholder replacement was not literal');
});

await check('existing draft and reload never trigger a second send', async () => {
    let f = await fixture({}, '<form><textarea>My existing draft</textarea><button type="submit">Send</button></form>');
    control(f.doc, 'claude_web_send_prompt').click();
    await wait(300);
    assert(f.doc.querySelector('main textarea').value === 'My existing draft' && f.marked() === 0, 'Existing draft overwritten');
    f = await fixture({ submitted: true });
    control(f.doc, 'claude_web_send_prompt').click();
    await wait(300);
    assert(f.marked() === 0, 'Reload resent prompt');
});

await check('missing send button leaves the prompt for manual send and never retries', async () => {
    const f = await fixture({}, '<form><textarea></textarea></form>');
    control(f.doc, 'claude_web_send_prompt').click();
    await wait(500);
    assert(f.marked() === 1, 'Submission not recorded');
    assert(f.doc.querySelector('main textarea').value === 'Test email: "Hello"', 'Prompt missing');
    assert(f.doc.querySelector('[role=status]').textContent === messages.claude_web_send_uncertain.message, 'Missing manual-send instruction');
    control(f.doc, 'claude_web_send_prompt').click();
    await wait(300);
    assert(f.marked() === 1, 'Ambiguous submission retried');
});

await check('streaming output is not offered as a completed response', async () => {
    const f = await fixture();
    control(f.doc, 'claude_web_send_prompt').click();
    await wait(500);
    f.doc.querySelector('.font-claude-response').dataset.isStreaming = 'true';
    await wait(2800);
    assert(control(f.doc, 'claude_web_review_response').disabled, 'Streaming response offered');
});

await check('changed response requires another review', async () => {
    const f = await fixture();
    control(f.doc, 'claude_web_send_prompt').click();
    await wait(3300);
    control(f.doc, 'claude_web_review_response').click();
    f.doc.querySelector('.font-claude-response').innerText += ' More text.';
    control(f.doc, 'claude_web_confirm_response').click();
    await wait(20);
    assert(f.applied.length === 0, 'Changed response applied without review');
});

await check('panel survives a page rerender with custom text intact', async () => {
    const f = await fixture({ doCustomText: true });
    f.doc.querySelector('[data-placeholder]').value = 'Keep this input';
    f.doc.getElementById('mzta-claude-panel').remove();
    await wait(20);
    assert(f.doc.querySelector('[data-placeholder]').value === 'Keep this input', 'Panel lost its input');
    assert(!f.doc.querySelector('#mzta-claude-panel').textContent.includes('MISSING:'), 'Missing i18n key');
});

document.title = `Claude Web checks: ${passed} passed, ${failed} failed`;
const summary = document.createElement('h2');
summary.id = 'summary';
summary.textContent = `${passed} passed, ${failed} failed`;
results.after(summary);
