// The Spam Filter settings page with its own Claude connection stored in the special prompt,
// stale spamfilter_* preferences and no global connection, no policy: spec 05 "Mandatory Specific
// Integration (feature settings pages)", "The Prompt Is Authoritative For API Parameters" (see
// tests/ui/feature-page.mjs, ownIntegrationScenario()). Nothing has been screened yet: spec 02
// "Missing special prompts" (the empty report log).

import assert from 'node:assert/strict';
import { msg } from '../../helpers/core/dom-harness.mjs';
import { ownIntegrationScenario } from '../../ui/feature-page.mjs';

await ownIntegrationScenario({
    page: 'spamfilter', nn: '02', prefix: 'spamfilter', promptId: 'prompt_spamfilter',
    defaultMsgKey: 'prompt_spamfilter_full_text', global: '',
    extraTests(ctx, k) {
        k.test('log-empty', 'spec 02 "Missing special prompts"', 'with no report the log shows one placeholder row spanning the 8 columns, under its header', () => {
            assert.ok(ctx.$('#report_data thead tr'), 'the header row was removed');
            const rows = ctx.$$('#report_data_body tr');
            assert.equal(rows.length, 1);
            assert.equal(rows[0].cells.length, 1);
            assert.equal(rows[0].cells[0].colSpan, 8);
            assert.equal(rows[0].cells[0].textContent, msg('spamfilter_no_reports'));
        });
    },
});
