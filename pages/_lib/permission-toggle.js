/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/*
 *  The one activation flow of a switch whose feature needs optional Thunderbird permissions
 *  (js/mzta-feature-permissions.js), shared by every page that shows one - the options page, the
 *  setup wizard, the spam filter and calendar event pages - so they cannot drift [#962]:
 *
 *    checked    permissions.request() is the FIRST await (it must stay within the user gesture);
 *               the preference is written true only once it resolved to true. Refused or failed:
 *               the switch goes back off and the user is told why; nothing is written, so the
 *               false the switch was showing stays stored (there is nothing to roll back).
 *    unchecked  false is written.
 *
 *  Never write true before the grant: every storage write wakes the background's reconciliation
 *  (_reconcileFeatureFlags() in mzta-background.js), which turns off a gated preference whose
 *  permissions are missing - the switch would stay on while the preference went back to false.
 *  That is also why the page's generic saveOptions() must skip these keys (isPermissionGatedPref()).
 *
 *  A switch locked by the enterprise policy is disabled by applyManagedUI(); if it still fires
 *  (re-enabled from the developer tools) the change is put back, with no prompt and no write.
 */

import {
    getFeatureLabel,
    getMissingPermissionMessage,
    hasFeaturePermissions,
    requestFeaturePermissions
} from '../../js/mzta-feature-permissions.js';
import { mztaPrefs } from '../../js/mzta-prefs.js';
import { isLockedKey } from './managed-ui.js';

/**
 * Bind the activation flow to a gated feature's switch.
 *
 * @param {HTMLInputElement} element  the checkbox
 * @param {string} key                its preference key (a key of FEATURE_PERMISSIONS)
 * @param {object} [o]
 *   onChange(checked)  awaited after the preference was written (or the switch put back off):
 *                      the page's own side effects (menus reload, "Manage" button)
 *   deniedMsgKey       i18n key of the alert when the user refuses (default feature_permission_denied,
 *                      which names the feature)
 *   errorMsgKey        i18n key of the alert when the request fails (default feature_permission_error)
 *   taLog              the page's logger
 */
export function bindPermissionToggle(element, key, o = {}) {
    if (!element) return;
    const taLog = o.taLog || console;
    const deniedMsgKey = o.deniedMsgKey || 'feature_permission_denied';
    const errorMsgKey = o.errorMsgKey || 'feature_permission_error';
    const refuse = async (msgKey) => {
        element.checked = false;
        if (o.onChange) await o.onChange(false);
        alert(browser.i18n.getMessage(msgKey, [getFeatureLabel(key)]));
    };
    element.addEventListener('change', async (event) => {
        if (isLockedKey(key)) {
            event.target.checked = !event.target.checked;
            return;
        }
        if (event.target.checked) {
            let granted = false;
            try {
                granted = await requestFeaturePermissions(key);
            } catch (err) {
                taLog.error('Error requesting the permissions of ' + key + ': ' + err);
                await refuse(errorMsgKey);
                return;
            }
            if (!granted) {
                await refuse(deniedMsgKey);
                return;
            }
            await mztaPrefs.setPref(key, true);
            if (o.onChange) await o.onChange(true);
        } else {
            await mztaPrefs.setPref(key, false);
            if (o.onChange) await o.onChange(false);
        }
    });
}

/**
 * Show a warning next to a gated switch the policy locks on while Thunderbird has not granted its
 * permissions: neither the reconciliation (which skips locked keys) nor the user (whose switch is
 * disabled) can fix that, so the page must at least say it. The note goes in the .feature_info of
 * the switch's .feature_row, with the same look as the other policy notes. Never throws.
 */
export async function showLockedPermissionWarning(element, key) {
    try {
        if (!element || !isLockedKey(key) || !element.checked) return;
        if (await hasFeaturePermissions(key)) return;
        const info = element.closest('.feature_row')?.querySelector('.feature_info');
        if (!info || info.querySelector('[data-mzta-permission-warning]')) return;
        const note = document.createElement('div');
        note.className = 'feature_locked_note shown';
        note.dataset.mztaPermissionWarning = key;
        note.textContent = getMissingPermissionMessage(key, true);
        info.appendChild(note);
    } catch (err) {
        console.error('[ThunderAI] Could not check the permissions of ' + key + ': ' + err);
    }
}
