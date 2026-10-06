/*
 *  What the prompt management pages need from a browser that jsdom does not implement, filled in
 *  by the ONE DOM file that needs it, after openPage(). Area-local: nothing here touches the core,
 *  and each stub lives only in the process of the file that installs it.
 *
 *   - <dialog>.showModal() / close(): jsdom has the element but not the two methods. The Custom
 *     Prompts page builds its choice dialogs (export, the dirty guard) with them.
 *   - HTMLElement.innerText: jsdom does not implement it. The Data Placeholders page reads and
 *     writes its row cells with it; for the plain inline spans it uses, Firefox returns their text,
 *     so the stub maps it to textContent.
 *   - the file picker of an import: the pages create an <input type="file">, click() it and wait for
 *     `change`. pickFile() answers the next such click with a file.
 *   - the downloaded file of an export: downloads.download() gets a blob: URL, read back here.
 *   - a cancelled confirm() for one action.
 *
 *  No jsdom import: the page's globals are already installed by openPage().
 */

import { resolveObjectURL } from 'node:buffer';

/** Make <dialog> modal methods work; returns helpers to answer the open dialog by its button label. */
export function stubDialogs(ctx) {
    const proto = ctx.window.HTMLDialogElement.prototype;
    proto.showModal = function () { this.setAttribute('open', ''); };
    proto.close = function () { this.removeAttribute('open'); };
    const open = () => ctx.document.querySelector('dialog[open]');
    return {
        open,
        /** The labels of the open dialog's buttons, in order. */
        labels: () => [...(open()?.querySelectorAll('button') || [])].map(b => b.textContent),
        /** Click the button of the open dialog whose label is `label`. */
        async choose(label) {
            const btn = [...(open()?.querySelectorAll('button') || [])].find(b => b.textContent === label);
            if (!btn) throw new Error('no open dialog with a "' + label + '" button');
            await ctx.click(btn);
        },
    };
}

/**
 * document.execCommand(): jsdom does not implement it. The autocomplete inserts a suggestion with
 * execCommand('insertText') and falls back to setRangeText() + an `input` event when it returns
 * false; the stub records the call and returns false, so the fallback runs. Returns the calls.
 */
export function stubExecCommand(ctx) {
    const calls = [];
    ctx.document.execCommand = (...args) => { calls.push(args); return false; };
    return calls;
}

/** innerText as Firefox gives it for the plain inline spans the pages use: their text. */
export function stubInnerText(ctx) {
    Object.defineProperty(ctx.window.HTMLElement.prototype, 'innerText', {
        configurable: true,
        get() { return this.textContent; },
        set(v) { this.textContent = v; },
    });
}

/**
 * Answer the next file picker the page opens with a file holding `content`, then settle until
 * `done()` holds (the page reads it with a FileReader, which settle() does not track).
 */
export async function pickFile(ctx, trigger, content, done, name = 'import.json') {
    const proto = ctx.window.HTMLInputElement.prototype;
    const realClick = proto.click;
    let picker = null;
    proto.click = function () {
        if (this.type === 'file') { picker = this; return; }
        return realClick.call(this);
    };
    try {
        await trigger();
    } finally {
        proto.click = realClick;
    }
    if (!picker) return false;
    const file = new ctx.window.File([content], name, { type: 'application/json' });
    Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    await picker.onchange();
    const start = Date.now();
    for (;;) {
        await ctx.settle();
        if (done()) return true;
        if (Date.now() - start > 5000) throw new Error('pickFile(): the import did not complete');
        await new Promise(r => setTimeout(r, 10));
    }
}

/** The parsed JSON of the file the page last handed to downloads.download(), with the call's options. */
export async function lastDownload(ctx) {
    const calls = ctx.apiCalls('browser.downloads.download');
    if (calls.length === 0) return null;
    const opts = calls.at(-1).args[0];
    const blob = resolveObjectURL(opts.url);
    return { opts, json: blob ? JSON.parse(await blob.text()) : null };
}

/** Run `fn` with window.confirm / confirm answering `answer`, recorded in ctx.dialogs like the stub. */
export async function withConfirm(ctx, answer, fn) {
    const realG = globalThis.confirm;
    const realW = ctx.window.confirm;
    const stub = (...args) => { ctx.dialogs.push({ kind: 'confirm', args }); return answer; };
    globalThis.confirm = stub;
    ctx.window.confirm = stub;
    try {
        return await fn();
    } finally {
        globalThis.confirm = realG;
        ctx.window.confirm = realW;
    }
}

/** Whether leaving the page now would ask for confirmation (its beforeunload handler). */
export function leaveBlocked(ctx) {
    const e = new ctx.window.Event('beforeunload', { cancelable: true });
    ctx.window.dispatchEvent(e);
    return e.defaultPrevented;
}
