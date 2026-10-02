// Spec 08 "An automatic summary is always inline":
//  - a policy summarize_auto of 2 or 3 makes a policy-supplied summarize_display_mode resolve to
//    'inline', whatever the policy wrote, with a warning for the administrator;
//  - the display mode takes the lock of summarize_auto: enforced when summarize_auto is locked,
//    an initial value when it is not - whatever the display mode's own ":locked" said;
//  - nothing changes for summarize_auto 0 or 1, nor when the display mode already agrees;
//  - a display mode the policy does not supply is not the loader's business: the user's own
//    stored value is left as it is.
// Each case is its own policy, so each runs in a fresh context (helpers/restart.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restart } from '../helpers/restart.mjs';

const KEYS = ['summarize_auto', 'summarize_display_mode'];
const loaded = policy => restart({ policy, local: {} }, 'managedKeys', KEYS);
const warnedAboutDisplayMode = r => r.warnings.some(w => w.includes('summarize_display_mode'));
const display = r => r.result.summarize_display_mode;

for (const auto of [2, 3]) {
    for (const displayLocked of [true, false]) {
        test(`locked summarize_auto ${auto} + ${displayLocked ? 'locked' : 'initial'} "webchat": "inline", locked`, async () => {
            const r = await loaded({
                summarize_auto: auto,
                summarize_display_mode: 'webchat', 'summarize_display_mode:locked': displayLocked,
            });
            assert.deepEqual(display(r), { managed: true, value: 'inline', locked: true });
            assert.ok(warnedAboutDisplayMode(r), 'no warning about summarize_display_mode');
        });
        test(`initial summarize_auto ${auto} + ${displayLocked ? 'locked' : 'initial'} "webchat": "inline", initial`, async () => {
            const r = await loaded({
                summarize_auto: auto, 'summarize_auto:locked': false,
                summarize_display_mode: 'webchat', 'summarize_display_mode:locked': displayLocked,
            });
            assert.deepEqual(display(r), { managed: true, value: 'inline', locked: false });
            assert.ok(warnedAboutDisplayMode(r), 'no warning about summarize_display_mode');
        });
    }
}

test('locked summarize_auto 3 + locked "inline": unchanged, no warning', async () => {
    const r = await loaded({ summarize_auto: 3, summarize_display_mode: 'inline' });
    assert.deepEqual(display(r), { managed: true, value: 'inline', locked: true });
    assert.equal(warnedAboutDisplayMode(r), false);
});

test('initial summarize_auto 3 + locked "inline": the lock follows summarize_auto, initial', async () => {
    const r = await loaded({ summarize_auto: 3, 'summarize_auto:locked': false, summarize_display_mode: 'inline' });
    assert.deepEqual(display(r), { managed: true, value: 'inline', locked: false });
});

for (const auto of [0, 1]) {
    test(`locked summarize_auto ${auto}: "webchat" is kept as the policy wrote it`, async () => {
        const r = await loaded({
            summarize_auto: auto,
            summarize_display_mode: 'webchat', 'summarize_display_mode:locked': false,
        });
        assert.deepEqual(display(r), { managed: true, value: 'webchat', locked: false });
        assert.equal(warnedAboutDisplayMode(r), false);
    });
}

test('locked summarize_auto 3 with no display mode in the policy: the stored user value is untouched', async () => {
    const r = await restart({ policy: { summarize_auto: 3 }, local: { summarize_display_mode: 'webchat' } },
        'readPrefs', KEYS);
    assert.equal(r.result.summarize_display_mode, 'webchat');
    assert.equal(r.local.summarize_display_mode, 'webchat');
    assert.equal(warnedAboutDisplayMode(r), false);
});

test('an initial "inline" (summarize_auto initial): the stored user value still wins', async () => {
    const r = await restart({
        policy: { summarize_auto: 3, 'summarize_auto:locked': false, summarize_display_mode: 'webchat' },
        local: { summarize_display_mode: 'webchat' },
    }, 'readPrefs', KEYS);
    // The user's stored value wins over an initial one, as for any other key.
    assert.equal(r.result.summarize_display_mode, 'webchat');
});

test('a locked "inline" wins over the stored user value', async () => {
    const r = await restart({
        policy: { summarize_auto: 3, summarize_display_mode: 'webchat', 'summarize_display_mode:locked': false },
        local: { summarize_display_mode: 'webchat' },
    }, 'readPrefs', KEYS);
    assert.equal(r.result.summarize_display_mode, 'inline');
});
