// Spec 08 "Controls with their own load/save logic" (updateAutoSendersState() "uses the
// respecting setter too: it could previously re-enable a locked summarize_auto_senders
// toggle") and "Marker placement and inertness": page logic that reassigns `disabled` must
// never re-enable a locked control.
//
// summarize_auto stays the user's; every one of its values is driven through the page.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/dom-page.mjs';
import { REASONS } from '../../helpers/dom-known-issues.mjs';

const LOCKED = ['summarize_auto_senders', 'summarize_auto_senders_list', 'summarize_display_mode'];
const ctx = await openPage('summarize', {
    policy: {
        summarize_auto_senders: true,
        summarize_auto_senders_list: ['boss@acme.example'],
        summarize_display_mode: 'webchat',
    },
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-user-own', summarize_auto: 1 },
});
after(() => ctx.close());

const seen = {};
{
    const auto = ctx.$('#summarize_auto');
    for (const value of ['0', '1', '2', '3', '1']) {
        auto.value = value;
        await ctx.fire(auto, 'change');
        seen[value] = {
            senders: ctx.$('#summarize_auto_senders').disabled,
            list: ctx.$('#summarize_auto_senders_list').disabled,
            save: ctx.$('#btn_save_auto_senders').disabled,
            display: ctx.$('#summarize_display_mode').disabled,
        };
    }
}

test('summarize_auto_senders, its list and Save stay disabled for every summarize_auto value', () => {
    for (const [value, s] of Object.entries(seen)) {
        assert.equal(s.senders, true, 'summarize_auto_senders re-enabled at summarize_auto=' + value);
        assert.equal(s.list, true, 'summarize_auto_senders_list re-enabled at summarize_auto=' + value);
        assert.equal(s.save, true, 'btn_save_auto_senders re-enabled at summarize_auto=' + value);
    }
});

test('summarize_display_mode stays disabled for every summarize_auto value', { todo: REASONS.displayModeReenabled }, () => {
    for (const [value, s] of Object.entries(seen)) {
        assert.equal(s.display, true, 'summarize_display_mode re-enabled at summarize_auto=' + value);
    }
});

test('none of the locked keys reached storage', () => {
    const local = ctx.ctl.localData();
    for (const k of LOCKED) assert.equal(local[k], undefined, k);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
