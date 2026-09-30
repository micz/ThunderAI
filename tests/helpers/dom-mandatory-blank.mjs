/*
 *  A mandatory specific integration waits for the user's choice. No policy involved.
 *
 *  With a global connection that cannot run the features (ChatGPT Web) and no override stored,
 *  initializeSpecificIntegrationUI() forces the feature's switch on as "mandatory", and persists
 *  the {prefix}_use_specific_integration / {prefix}_connection_type pair only together with the
 *  first usable connection the USER picks. So the connection type select must open blank: a
 *  preselected first option (OpenAI API) would be written as if the user had chosen it, just by
 *  opening the page. Generated from FEATURE_PAGES (./feature-pages.mjs), one file per page.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from './dom-page.mjs';
import { FEATURE_PAGES, prefixOfPage } from './feature-pages.mjs';

export async function mandatoryBlankScenario(page) {
    const prefix = prefixOfPage(page);
    const feature = FEATURE_PAGES[prefix];
    const ctx = await openPage(page, { local: { connection_type: 'chatgpt_web' } });
    after(() => ctx.close());

    test('the switch is forced on as mandatory', () => {
        const sw = ctx.$('#' + prefix + '_use_specific_integration');
        assert.equal(sw.checked, true);
        assert.equal(sw.dataset.mandatory, 'true');
    });

    test('the connection type select opens blank, with no provider preselected', () => {
        const select = ctx.$('#' + prefix + '_connection_type');
        assert.equal(select.value, '');
        assert.equal(select.selectedIndex, -1);
    });

    test('opening the page stores no connection the user did not choose', () => {
        const local = ctx.ctl.localData();
        assert.equal(prefix + '_connection_type' in local, false,
            prefix + '_connection_type stored as ' + JSON.stringify(local[prefix + '_connection_type']));
        assert.equal(prefix + '_use_specific_integration' in local, false);
        const p = (local._special_prompts || []).find(s => s.id === feature.promptId);
        assert.ok(!p || !p.api_type, 'api_type stored as ' + JSON.stringify(p && p.api_type));
    });

    test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
    return ctx;
}
