// Links in the transcript and the page's Content Security Policy (issue #1001). A ChatGPT API
// window proofreading a selection (action "2", the diff viewer on), usage display off. One answer
// holds every kind of link the sanitizer lets through; clicks, middle clicks and drags on them
// are dispatched as the browser would (composed, cancelable) and windows.openDefaultBrowser() is
// the webchat plugin's, recorded by the harness. Links the sanitizer never lets through are added
// to the answer by the test, as the handler's own defence would see them were it to fail.
//
// Spec 01 "Links in the transcript" (every activation of a link cancelled; only an http(s) URL
// with no credentials opened, in the default browser; left click, modified click and middle
// button; a right button never opens; a link in the diff picker never opens; a link cannot be
// dragged; a failure to open logged), "Content Security Policy" (the meta CSP, first in <head>,
// with exactly the agreed directives; no inline script, style or handler in index.html; every
// component styled through adoptedStyleSheets, no <style> anywhere in the page).
//
// The tests run in order on one window.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { REPO } from '../../helpers/core/load.mjs';
import { webchatTests } from '../../helpers/known-issues/webchat.mjs';
import {
    openWebchat,
    apiSend,
    botTurns,
    answerEls,
    actionBar,
    turnBody,
} from '../../webchat/webchat-page.mjs';
import { deepElements } from '../../webchat/shadow.mjs';

let failNextOpen = false;
const { ctx, worker } = await openWebchat({
    local: { chat_show_usage_data: false, diff_granularity: 'words' },
    commands: {
        chatgpt_replaceSelectedText: () => true,
        chatgpt_close: () => true,
    },
    openDefaultBrowser: () => {
        if (failNextOpen) {
            failNextOpen = false;
            throw new Error('no default browser');
        }
    },
});
after(() => ctx.close());
const k = webchatTests('20');

const S_LINKS = 'spec 01 "Links in the transcript"';
const S_CSP = 'spec 01 "Content Security Policy"';

const OPEN = 'browser.windows.openDefaultBrowser';
const opened = () => ctx.apiCalls(OPEN).map(c => c.args[0]);

await apiSend(ctx, {
    prompt: 'Proofread', action: '2', tabId: 3, mailMessageId: 7,
    prompt_info: {
        use_diff_viewer: '1',
        selection_text: 'Read the guide.',
        selection_html: '<p>Read the guide.</p>',
        body_text: 'unrelated body', body_html: '<p>unrelated body</p>',
    },
});
await worker.stream(ctx, [
    'Read [the guide](https://example.com/guide?a=1#top) and [plain](http://example.org/).\n\n'
    + 'Also [creds](https://user:pass@example.com/), [user](https://user@example.com/), '
    + '[mail](mailto:someone@example.com) and <a href="https://example.net/"><b>bold link</b></a>.',
]);

const answer = () => answerEls(botTurns(ctx)[0])[0];
const link = text => [...answer().querySelectorAll('a')].find(a => a.textContent === text);

/** Dispatch a mouse event as the browser does (composed, cancelable); the event, once settled. */
async function mouse(el, type, init = {}) {
    const ev = new ctx.window.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0, ...init });
    el.dispatchEvent(ev);
    await ctx.settle();
    return ev;
}
/** An anchor the sanitizer would never let through, appended to the answer. */
function forgedLink(href) {
    const a = ctx.document.createElement('a');
    if (href !== null) a.setAttribute('href', href);
    a.textContent = 'forged';
    answer().appendChild(a);
    return a;
}

k.test('https-click', S_LINKS, 'a left click on an https link opens it in the default browser, the page staying put', async () => {
    const before = opened().length;
    const ev = await mouse(link('the guide'), 'click');
    assert.equal(ev.defaultPrevented, true);
    assert.deepEqual(opened().slice(before), ['https://example.com/guide?a=1#top']);
    assert.match(ctx.window.location.href, /api_webchat\/index\.html\?llm=/);
});

k.test('http-click', S_LINKS, 'an http link opens too', async () => {
    const before = opened().length;
    await mouse(link('plain'), 'click');
    assert.deepEqual(opened().slice(before), ['http://example.org/']);
});

k.test('inner-element', S_LINKS, 'a click on an element inside the link opens the link', async () => {
    const before = opened().length;
    const ev = await mouse(link('bold link').querySelector('b'), 'click');
    assert.equal(ev.defaultPrevented, true);
    assert.deepEqual(opened().slice(before), ['https://example.net/']);
});

k.test('modified-click', S_LINKS, 'Ctrl, Cmd and Shift + click open it in the default browser as well, once each', async () => {
    const before = opened().length;
    for (const mod of ['ctrlKey', 'metaKey', 'shiftKey']) {
        const ev = await mouse(link('plain'), 'click', { [mod]: true });
        assert.equal(ev.defaultPrevented, true, mod);
    }
    assert.deepEqual(opened().slice(before), ['http://example.org/', 'http://example.org/', 'http://example.org/']);
});

k.test('middle-button', S_LINKS, 'the middle button (auxclick) opens it once, a click reported for that button does not open it again', async () => {
    const before = opened().length;
    const aux = await mouse(link('the guide'), 'auxclick', { button: 1 });
    const click = await mouse(link('the guide'), 'click', { button: 1 });
    assert.equal(aux.defaultPrevented, true);
    assert.equal(click.defaultPrevented, true);
    assert.deepEqual(opened().slice(before), ['https://example.com/guide?a=1#top']);
});

k.test('right-button', S_LINKS, 'the right button never opens a link', async () => {
    const before = opened().length;
    const ev = await mouse(link('the guide'), 'auxclick', { button: 2 });
    assert.equal(ev.defaultPrevented, true);
    assert.equal(opened().length, before);
});

k.test('credentials', S_LINKS, 'a link with a user name or a password in it stays inert', async () => {
    const before = opened().length;
    for (const text of ['creds', 'user']) {
        assert.ok(link(text), text + ' kept by the sanitizer');
        assert.equal((await mouse(link(text), 'click')).defaultPrevented, true, text);
        assert.equal((await mouse(link(text), 'auxclick', { button: 1 })).defaultPrevented, true, text);
    }
    assert.equal(opened().length, before);
});

k.test('mailto', S_LINKS, 'a mailto: link stays inert', async () => {
    const before = opened().length;
    assert.equal(link('mail').getAttribute('href'), 'mailto:someone@example.com');
    assert.equal((await mouse(link('mail'), 'click')).defaultPrevented, true);
    assert.equal((await mouse(link('mail'), 'auxclick', { button: 1 })).defaultPrevented, true);
    assert.equal(opened().length, before);
});

k.test('other-hrefs', S_LINKS, 'were the sanitizer to let one through: another scheme, a relative URL, a fragment, a malformed or missing href stays inert', async () => {
    const before = opened().length;
    for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://example.com/',
        '/relative', 'relative/path', '//example.com/x', '#top', 'https://', '', null]) {
        const a = forgedLink(href);
        assert.equal((await mouse(a, 'click')).defaultPrevented, true, String(href));
        assert.equal((await mouse(a, 'auxclick', { button: 1 })).defaultPrevented, true, String(href));
        a.remove();
    }
    assert.equal(opened().length, before);
});

k.test('scheme-case', S_LINKS, 'the scheme is matched as parsed: HTTPS:// in capitals opens, normalized', async () => {
    const before = opened().length;
    const a = forgedLink('HTTPS://EXAMPLE.COM/Path');
    await mouse(a, 'click');
    a.remove();
    assert.deepEqual(opened().slice(before), ['https://example.com/Path']);
});

k.test('not-a-link', S_LINKS, 'a click elsewhere in the answer is left alone', async () => {
    const before = opened().length;
    const ev = await mouse(answer(), 'click');
    assert.equal(ev.defaultPrevented, false);
    assert.equal(opened().length, before);
});

k.test('drag', S_LINKS, 'dragging a link is cancelled; dragging the answer text is not', async () => {
    const onLink = await mouse(link('the guide'), 'dragstart');
    const onInner = await mouse(link('bold link').querySelector('b'), 'dragstart');
    const onText = await mouse(answer(), 'dragstart');
    assert.equal(onLink.defaultPrevented, true);
    assert.equal(onInner.defaultPrevented, true);
    assert.equal(onText.defaultPrevented, false);
});

k.test('open-fails', S_LINKS, 'a default browser that cannot be opened is logged, with no unhandled rejection', async () => {
    ctx.con.clear();
    failNextOpen = true;
    await mouse(link('plain'), 'click');
    assert.ok(ctx.con.entries.some(e => e.level === 'error' && /Unable to open the link in the default browser/.test(e.msg)),
        'nothing logged');
    assert.deepEqual(ctx.rejections, []);
});

const picker = () => turnBody(botTurns(ctx)[1]).querySelector('diff-picker');

k.test('picker', S_LINKS, 'a link inside the diff picker never opens: the click chooses the side it is on', async () => {
    await ctx.click(actionBar(botTurns(ctx)[0]).querySelector('.diffv_btn'));
    assert.ok(picker(), 'the picker did not open');
    const links = [...picker().shadowRoot.querySelectorAll('a[href^="https://example.com/guide"]')];
    assert.ok(links.length > 0, 'no link in the picker');
    const before = opened().length;
    for (const a of links) {
        assert.equal((await mouse(a, 'click')).defaultPrevented, true);
        assert.equal((await mouse(a, 'auxclick', { button: 1 })).defaultPrevented, true);
        assert.equal((await mouse(a, 'dragstart')).defaultPrevented, true);
    }
    assert.equal(opened().length, before);
});

// ── Content Security Policy ──────────────────────────────────────────────────

const PAGE_HTML = readFileSync(new URL('api_webchat/index.html', REPO), 'utf8');
const pageDoc = new ctx.window.DOMParser().parseFromString(PAGE_HTML, 'text/html');

k.test('csp-meta', S_CSP, 'the CSP is the first element of <head>, with exactly the agreed directives', () => {
    const meta = pageDoc.head.firstElementChild;
    assert.equal(meta.localName, 'meta');
    assert.equal(meta.getAttribute('http-equiv'), 'Content-Security-Policy');
    const directives = Object.fromEntries(meta.getAttribute('content').split(';')
        .map(d => d.trim()).filter(Boolean)
        .map(d => { const [name, ...values] = d.split(/\s+/); return [name, values]; }));
    assert.deepEqual(directives, {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'"],
        'connect-src': ["'self'", 'http:', 'https:'],
        'worker-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-src': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'none'"],
    });
    assert.equal(pageDoc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]').length, 1);
});

k.test('csp-no-inline', S_CSP, 'index.html holds no inline script, <style>, style attribute or event handler', () => {
    assert.deepEqual([...pageDoc.querySelectorAll('script:not([src])')].map(s => s.outerHTML), []);
    assert.deepEqual([...pageDoc.querySelectorAll('style, [style]')].map(el => el.localName), []);
    const handlers = [...pageDoc.querySelectorAll('*')].flatMap(el =>
        [...el.attributes].filter(a => a.name.startsWith('on')).map(a => `${el.localName}[${a.name}]`));
    assert.deepEqual(handlers, []);
});

k.test('csp-adopted-sheets', S_CSP, 'every component is styled through adoptedStyleSheets, and no <style> exists anywhere in the page', () => {
    const hosts = [...deepElements(ctx.document)].filter(el => el.shadowRoot);
    const names = new Set(hosts.map(h => h.localName));
    for (const name of ['messages-area', 'message-input', 'split-button', 'diff-picker']) {
        assert.ok(names.has(name), name + ' not on the page');
    }
    for (const host of hosts) {
        assert.equal(host.shadowRoot.adoptedStyleSheets.length, 1, host.localName);
    }
    assert.deepEqual([...deepElements(ctx.document)].filter(el => el.localName === 'style').map(el => el.parentNode.host?.localName ?? el.parentNode.nodeName), []);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
