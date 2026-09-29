/*
 *  Probes run in a fresh worker thread: a page opened in its own module graph, or the
 *  allowlist as the real js/mzta-managed.js derives it.
 *
 *  The allowlist sweep needs to know, BEFORE it opens the page under a policy, which
 *  allowlisted keys have a control on that page, what those controls accept (select options,
 *  number ranges) and how the page shows them without any policy (the baseline). The page's
 *  modules are singletons, so that cannot happen in the test's own process: it happens here,
 *  in a worker, exactly like helpers/restart.mjs runs a second extension context.
 */

import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';

/** Serialisable description of one managed-candidate control. */
function describe(el) {
    const key = el.dataset.mztaPref || (el.classList.contains('option-input') ? el.id : '');
    const d = {
        key,
        id: el.id,
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        viaDataPref: !!el.dataset.mztaPref,
        value: el.value,
        checked: !!el.checked,
        disabled: !!el.disabled,
        readOnly: !!el.readOnly,
        min: el.getAttribute('min'),
        max: el.getAttribute('max'),
        step: el.getAttribute('step'),
    };
    if (d.tag === 'select') {
        d.options = [...el.options].map(o => ({ value: o.value, disabled: o.disabled }));
    }
    return d;
}

async function runInWorker({ mode, page, opts }) {
    if (mode === 'allowlist') {
        const { installBrowserMock } = await import('./browser-mock.mjs');
        const { captureConsole, loadModules } = await import('./load.mjs');
        const { buildEveryKeyPolicy } = await import('../fixtures/every-pref-key.mjs');
        const { prefs_default } = await import('../../options/mzta-options-default.js');
        installBrowserMock({ policy: buildEveryKeyPolicy(prefs_default) });
        captureConsole();
        const m = await loadModules();
        await m.mztaManaged.loadManaged();
        return Object.keys(m.prefs_default).filter(k => m.mztaManaged.hasManagedValue(k));
    }
    if (mode === 'page') {
        const { openPage } = await import('./dom-page.mjs');
        const ctx = await openPage(page, opts);
        const controls = [...ctx.document.querySelectorAll('.option-input, [data-mzta-pref]')].map(describe);
        const result = {
            controls,
            violations: ctx.violations,
            rejections: ctx.rejections,
            jsdomErrors: ctx.jsdomErrors,
        };
        ctx.close();
        return result;
    }
    throw new Error('dom-probe: unknown mode ' + mode);
}

function run(data) {
    return new Promise((resolve, reject) => {
        const w = new Worker(new URL(import.meta.url), { workerData: data, stdout: true, stderr: true });
        let err = '';
        w.stderr.on('data', c => { err += c; });
        w.stdout.on('data', () => {});
        w.once('message', m => (m.error ? reject(new Error(m.error + '\n' + err)) : resolve(m.result)));
        w.once('error', reject);
        w.once('exit', code => { if (code !== 0) reject(new Error('dom-probe worker exited with ' + code + '\n' + err)); });
    });
}

/** The allowlist, as the real module derives it from prefs_default. */
export const probeAllowlist = () => run({ mode: 'allowlist' });

/** Open a page unmanaged-or-not in a fresh context and describe its controls. */
export const probePage = (page, opts = {}) => run({ mode: 'page', page, opts });

if (!isMainThread && workerData && workerData.mode) {
    runInWorker(workerData).then(
        result => { parentPort.postMessage({ result }); process.exit(0); },
        e => { parentPort.postMessage({ error: String(e && e.stack || e) }); process.exit(0); },
    );
}
