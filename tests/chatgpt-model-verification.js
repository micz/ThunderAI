import { mzta_script } from '../js/mzta-chatgpt.js';

const fixture = await (await fetch('./fixtures/chatgpt-model-picker.html')).text();
const messages = await (await fetch('../_locales/en/messages.json')).json();
const defaults = {
    mztaGPTModel: 'gpt-6', mztaDoDebug: '0', mztaDoCustomText: '0',
    mztaPromptName: '[Model verification test]', mztaPhDefVal: '1',
    mztaUseDiffViewer: '0', mztaOriginalText: '', mztaReplyType: 'reply_sender',
    mztaWinId: 0, mztaStatusPageDesc: '', mztaForceCompletionDesc: '', mztaForceCompletionTitle: ''
};
const prelude = Object.entries(defaults).map(([key, value]) => 'let ' + key + '=' + JSON.stringify(value) + ';').join('\n');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// Keep production timeout values. Move a per-frame clock instead of waiting 15s per case.
function installClock(win) {
    let now = 0;
    let sequence = 0;
    const jobs = new Map();
    const observers = new Set();
    win.Date.now = () => now;
    win.setTimeout = (fn, delay = 0) => {
        const id = ++sequence;
        jobs.set(id, { fn, at: now + delay, repeat: 0 });
        return id;
    };
    win.setInterval = (fn, delay) => {
        const id = ++sequence;
        jobs.set(id, { fn, at: now + delay, repeat: delay });
        return id;
    };
    win.clearTimeout = win.clearInterval = id => jobs.delete(id);
    const NativeObserver = win.MutationObserver;
    win.MutationObserver = class extends NativeObserver {
        observe(...args) { observers.add(this); return super.observe(...args); }
        disconnect() { observers.delete(this); return super.disconnect(); }
    };
    return {
        count: () => ({ timers: jobs.size, observers: observers.size }),
        async advance(ms) {
            const end = now + ms;
            await flush();
            while (true) {
                const next = [...jobs].filter(([, job]) => job.at <= end)
                    .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
                if (!next) break;
                const [id, job] = next;
                now = job.at;
                if (job.repeat) job.at += job.repeat;
                else jobs.delete(id);
                job.fn();
                await flush();
            }
            now = end;
            await flush();
        }
    };
}

async function setup(model = 'gpt-6', effort = 'none') {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const win = frame.contentWindow;
    const doc = win.document;
    doc.body.innerHTML = fixture;
    const clock = installClock(win);
    const trigger = doc.querySelector('[data-selected-reasoning-effort]');
    trigger.setAttribute('data-selected-reasoning-effort', effort);
    const events = { sends: 0, modelClicks: 0, opens: 0, closes: 0 };

    function wireTrigger(button) {
        // Radix opens via keydown, not a synthetic click on the trigger.
        button.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || button.getAttribute('aria-expanded') === 'true') return;
            events.opens++;
            button.setAttribute('aria-expanded', 'true');
            const menu = doc.getElementById('model-menu-fixture').content.firstElementChild.cloneNode(true);
            menu.setAttribute('aria-labelledby', button.id);
            menu.querySelector('[data-model-picker-view-toggle]').addEventListener('click', () => {
                const view = menu.querySelector('[data-model-picker-view]');
                const advanced = view.getAttribute('data-model-picker-view') === 'simple';
                view.setAttribute('data-model-picker-view', advanced ? 'advanced' : 'simple');
                const track = menu.querySelector('[inert], [data-active="true"]:has([role="menuitemradio"])');
                track.setAttribute('aria-hidden', advanced ? 'false' : 'true');
                track.setAttribute('data-active', advanced ? 'true' : 'false');
                track.toggleAttribute('inert', !advanced);
            });
            menu.addEventListener('keydown', e => {
                if (e.key !== 'Escape') return;
                events.closes++;
                button.setAttribute('aria-expanded', 'false');
                menu.remove();
            });
            menu.querySelectorAll('[role="menuitemradio"]').forEach(row => row.addEventListener('click', () => events.modelClicks++));
            doc.body.append(menu);
        });
    }
    wireTrigger(trigger);
    doc.getElementById('composer-submit-button').addEventListener('click', () => {
        events.sends++;
        doc.getElementById('prompt-textarea').innerHTML = '';
    });
    const browser = {
        i18n: { getMessage: key => messages[key]?.message || key },
        runtime: { getURL: path => path, getManifest: () => ({ version: 'test' }),
            onMessage: { addListener() {} }, sendMessage: async () => {} }
    };
    // Evaluate the full production script, not a test copy of the verifier.
    // Completion/layout handling is outside this change; the real composer/send code stays active.
    const api = new win.Function('browser', prelude + mzta_script + `
        chatgpt_isIdle = async () => {};
        showForceCompletionHint = async () => {};
        operation_done = () => {};
        installComposerOverlapWatch = () => {};
        mztaFixComposerOverlap = () => {};
        return { checkGPTModel, doProceed, isGPT6Selected,
            init(model) { mztaGPTModel = model; current_action = '0'; addCustomDiv('0', 0, -1); }
        };
    `)(browser);
    api.init(model);
    await clock.advance(1000); // Settle the existing UI layout timer before measuring verifier resources.
    const baseline = clock.count();
    return { api, doc, win, clock, events, trigger, wireTrigger,
        message: { prompt: 'ThunderAI model verification test.', prompt_info: {} },
        assertClean() {
            const count = clock.count();
            assert(count.timers === baseline.timers, 'Verification timers remain active: ' + JSON.stringify(count));
            assert(count.observers === baseline.observers, 'Verification observers remain connected: ' + JSON.stringify(count));
            assert(events.modelClicks === 0, 'Model selection was changed');
        },
        dispose() { frame.remove(); }
    };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });
const warningVisible = h => h.doc.getElementById('mzta-model_warn').style.display === 'inline-block';
const waitForTimeout = async h => { await h.clock.advance(15000); assert(warningVisible(h), 'Timeout warning is missing'); h.assertClean(); };
const openMenu = h => h.trigger.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

for (const [id, effort] of [['gpt-6', 'none'], ['gpt-6-thinking', 'medium']]) {
    test(id + ': automatically sends once through the actual send function', async h => {
        h.trigger.setAttribute('data-selected-reasoning-effort', effort);
        h.api.init(id);
        await Promise.all([h.api.doProceed(h.message), h.clock.advance(1000)]);
        assert(h.events.sends === 1, 'Send count: ' + h.events.sends);
        assert(!warningVisible(h), 'Warning shown after successful verification');
        assert(h.events.opens === 1 && h.events.closes === 1, 'The opened menu was not closed');
        h.assertClean();
    });
}
test('Rejects a different selected model', async h => {
    const template = h.doc.getElementById('model-menu-fixture').content;
    template.querySelector('[data-model-selected] [data-menu-row-content] > span').textContent = 'GPT-5.6 Sol';
    void h.api.doProceed(h.message);
    await waitForTimeout(h);
    assert(h.events.sends === 0, 'Sent with a different model');
});
for (const effort of ['medium', 'high', 'unknown']) {
    test('Instant request rejects effort ' + effort, async h => {
        h.trigger.setAttribute('data-selected-reasoning-effort', effort);
        void h.api.doProceed(h.message);
        await waitForTimeout(h);
        assert(h.events.sends === 0 && h.events.opens === 0, 'Sent or opened the menu with the wrong effort');
    });
}
test('Medium request rejects Instant', async h => {
    h.api.init('gpt-6-thinking');
    void h.api.doProceed(h.message);
    await waitForTimeout(h);
    assert(h.events.sends === 0, 'Sent with Instant');
});
test('Unselected GPT-6 and body text do not pass verification', async h => {
    const rows = h.doc.getElementById('model-menu-fixture').content.querySelectorAll('[role="menuitemradio"]');
    rows[0].setAttribute('aria-checked', 'false'); rows[0].removeAttribute('data-model-selected');
    rows[1].setAttribute('aria-checked', 'true'); rows[1].setAttribute('data-model-selected', 'true');
    const text = h.doc.createElement('p'); text.textContent = 'GPT-6 Instant'; h.doc.body.append(text);
    void h.api.doProceed(h.message);
    await waitForTimeout(h);
    assert(h.events.sends === 0, 'Sent based on text outside the selected state');
});
test('Missing DOM does not pass as a free account', async h => {
    h.trigger.remove();
    void h.api.doProceed(h.message);
    await waitForTimeout(h);
    assert(h.events.sends === 0, 'Sent without model DOM');
});
test('Rejects an unrelated menu', async h => {
    h.doc.getElementById('model-menu-fixture').content.firstElementChild.setAttribute('aria-labelledby', 'other');
    openMenu(h);
    h.doc.querySelector('[role="menu"]').setAttribute('aria-labelledby', 'other');
    void h.api.doProceed(h.message);
    await waitForTimeout(h);
    assert(h.events.sends === 0, 'Sent based on an unrelated menu');
});
test('Rejects a hidden selected item', async h => {
    h.doc.getElementById('model-menu-fixture').content.querySelector('[data-model-selected]').hidden = true;
    void h.api.doProceed(h.message);
    await waitForTimeout(h);
    assert(h.events.sends === 0, 'Sent based on a hidden selected item');
});
test('Rejects inconsistent checked and selected attributes', async h => {
    h.doc.getElementById('model-menu-fixture').content.querySelector('[data-model-selected]').removeAttribute('data-model-selected');
    void h.api.doProceed(h.message);
    await waitForTimeout(h);
    assert(h.events.sends === 0, 'Sent with a missing selection attribute');
});
test('Queries fresh DOM and sends after delayed rendering', async h => {
    h.trigger.remove();
    void h.api.doProceed(h.message);
    await h.clock.advance(500);
    h.doc.querySelector('main').append(h.trigger);
    await h.clock.advance(1000);
    assert(h.events.sends === 1, 'Did not send after delayed DOM rendering'); h.assertClean();
});
test('Sends once despite trigger replacement and duplicate calls during verification', async h => {
    h.trigger.setAttribute('data-selected-reasoning-effort', 'high');
    void h.api.doProceed(h.message); void h.api.doProceed(h.message);
    await h.clock.advance(100);
    const replacement = h.trigger.cloneNode(true);
    replacement.setAttribute('data-selected-reasoning-effort', 'none');
    h.wireTrigger(replacement); h.trigger.replaceWith(replacement);
    await h.clock.advance(1000);
    await h.api.doProceed(h.message);
    assert(h.events.sends === 1, 'Send count after re-render: ' + h.events.sends); h.assertClean();
});
test('Matching DOM after timeout does not trigger automatic sending', async h => {
    h.trigger.setAttribute('data-selected-reasoning-effort', 'high');
    void h.api.doProceed(h.message);
    await waitForTimeout(h);
    h.trigger.setAttribute('data-selected-reasoning-effort', 'none');
    await h.clock.advance(1000);
    assert(h.events.sends === 0, 'Sent automatically after timeout'); h.assertClean();
});
test('Sends once after timeout despite repeated manual clicks and duplicate requests', async h => {
    h.trigger.remove();
    void h.api.doProceed(h.message);
    await waitForTimeout(h);
    const button = h.doc.getElementById('mzta-btn_model');
    button.click(); button.click(); void h.api.doProceed(h.message);
    await h.clock.advance(1000);
    button.click(); await h.api.doProceed(h.message);
    assert(h.events.sends === 1, 'Manual send count: ' + h.events.sends);
    assert(!warningVisible(h), 'Warning remains after manual resume'); h.assertClean();
});
test('Manual approval is not reused for the next verification', async h => {
    h.trigger.remove();
    let first = false; h.api.checkGPTModel('gpt-6').then(() => { first = true; });
    await waitForTimeout(h);
    h.doc.getElementById('mzta-btn_model').click(); await flush();
    assert(first, 'Manual resume failed');
    let second = false; h.api.checkGPTModel('gpt-6').then(() => { second = true; });
    await h.clock.advance(1000);
    assert(!second, 'Manual approval leaked into the next verification');
    h.win.dispatchEvent(new h.win.Event('pagehide')); await flush(); h.assertClean();
});
test('A match just before the deadline succeeds without a timeout warning', async h => {
    h.trigger.setAttribute('data-selected-reasoning-effort', 'high');
    void h.api.doProceed(h.message);
    await h.clock.advance(14999);
    h.trigger.setAttribute('data-selected-reasoning-effort', 'none');
    await h.clock.advance(1001);
    assert(h.events.sends === 1 && !warningVisible(h), 'Success/timeout race failed'); h.assertClean();
});
test('Preserves the view and open state of an already open menu', async h => {
    openMenu(h);
    void h.api.doProceed(h.message);
    await h.clock.advance(1000);
    assert(h.events.sends === 1 && h.events.closes === 0, 'Closed a menu opened by the user');
    assert(h.doc.querySelector('[data-model-picker-view="simple"]'), 'Menu view was not restored'); h.assertClean();
});
test('Closes its own menu and restores the view on failure', async h => {
    h.doc.getElementById('model-menu-fixture').content.querySelector('[data-model-selected] span').textContent = 'Other';
    void h.api.doProceed(h.message); await waitForTimeout(h);
    assert(h.events.opens === 1 && h.events.closes === 1, 'Menu remains open after failure');
});
test('Preserves focus moved by the user during verification', async h => {
    h.doc.getElementById('model-menu-fixture').content.querySelector('[data-model-selected] span').textContent = 'Other';
    void h.api.doProceed(h.message); await h.clock.advance(100);
    const composer = h.doc.getElementById('prompt-textarea'); composer.focus();
    await h.clock.advance(14900);
    assert(h.doc.activeElement === composer, 'Took focus away from the user'); h.assertClean();
});
test('Manual resume preserves a menu reopened by the user after timeout', async h => {
    h.doc.getElementById('model-menu-fixture').content.querySelector('[data-model-selected] span').textContent = 'Other';
    void h.api.doProceed(h.message); await waitForTimeout(h);
    openMenu(h);
    h.doc.getElementById('mzta-btn_model').click(); await h.clock.advance(1000);
    assert(h.events.sends === 1 && h.events.closes === 1, 'Manual resume closed the new menu'); h.assertClean();
});
test('Page exit after timeout cancels the manual wait', async h => {
    h.trigger.remove();
    const pending = h.api.doProceed(h.message); await waitForTimeout(h);
    h.win.dispatchEvent(new h.win.Event('pagehide')); await pending;
    h.doc.getElementById('mzta-btn_model').click(); await h.clock.advance(1000);
    assert(h.events.sends === 0, 'Sent after the manual wait was cancelled'); h.assertClean();
});
test('Page exit cancels verification without sending', async h => {
    h.trigger.setAttribute('data-selected-reasoning-effort', 'high');
    const pending = h.api.doProceed(h.message);
    h.win.dispatchEvent(new h.win.Event('pagehide')); await pending;
    assert(h.events.sends === 0, 'Sent during page exit'); h.assertClean();
});
test('An empty model setting sends without verification', async h => {
    h.api.init(''); h.trigger.remove();
    void h.api.doProceed(h.message); await h.clock.advance(1000);
    assert(h.events.sends === 1 && h.events.opens === 0, 'Empty model setting regression'); h.assertClean();
});
test('Preserves legacy display-name verification', async h => {
    h.api.init('5 Thinking'); h.trigger.querySelector('span').textContent = '5 Thinking';
    void h.api.doProceed(h.message); await h.clock.advance(1000);
    assert(h.events.sends === 1 && h.events.opens === 0, 'Legacy model verification regression'); h.assertClean();
});
test('Preserves the legacy free-account branch', async h => {
    h.api.init('5'); h.trigger.remove();
    void h.api.doProceed(h.message); await h.clock.advance(1000);
    assert(h.events.sends === 1, 'Legacy free-account branch regression'); h.assertClean();
});
test('A legacy model mismatch allows manual resume after a bounded wait', async h => {
    h.api.init('5 Thinking');
    void h.api.doProceed(h.message); await waitForTimeout(h);
    assert(h.events.sends === 0, 'Sent despite a legacy model mismatch');
    h.doc.getElementById('mzta-btn_model').click(); await h.clock.advance(1000);
    assert(h.events.sends === 1, 'Legacy manual resume regression'); h.assertClean();
});

let passed = 0;
for (const { name, run } of tests) {
    const row = document.createElement('li');
    document.getElementById('results').append(row);
    let h;
    try {
        h = await setup(); await run(h);
        row.textContent = 'PASS — ' + name; row.className = 'pass'; passed++;
    } catch (error) {
        row.textContent = 'FAIL — ' + name + ': ' + error.stack; row.className = 'fail';
    } finally { h?.dispose(); }
}
document.getElementById('summary').textContent = passed + '/' + tests.length + ' passed';
document.title = 'ThunderAI: ' + passed + '/' + tests.length + ' passed';

// ChatGPT consumes/removes the URL model parameter after loading. Keep the requested
// ID explicit, like background.js does; the URL is never proof of the selected model.
const liveMessages = Object.fromEntries(Object.entries(messages).filter(([key]) =>
    key.startsWith('chatgpt_') || mzta_script.includes('"' + key + '"') || mzta_script.includes("'" + key + "'")));
function updateLiveScript() {
document.getElementById('live-script').value = `(() => {
    const browser = {
        i18n: { getMessage: key => (${JSON.stringify(liveMessages)})[key]?.message || key },
        runtime: { getManifest: () => ({version: 'Web test'}), getURL: () => 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
            onMessage: {addListener(fn) { this.receive = fn; }}, sendMessage: async () => {} }
    };
    ${prelude}
    mztaGPTModel = ${JSON.stringify(document.getElementById('live-model').value)};
    mztaDoDebug = '1';
    ${mzta_script}
    const composer = queryPromptInput([document])?.el;
    if (!composer || (composer.tagName === 'TEXTAREA' ? composer.value : composer.textContent).trim()) {
        throw new Error('Use an empty composer; the test must not overwrite a draft.');
    }
    browser.runtime.onMessage.receive({command: 'chatgpt_send', prompt: 'ThunderAI model verification test. Reply with only OK.', action: '0', tabId: 0, mailMessageId: -1, prompt_info: {}});
})()`;
}
document.getElementById('live-model').addEventListener('change', updateLiveScript);
updateLiveScript();
