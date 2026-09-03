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

// Shared timezone list for the timezone selects (calendar event and task pages).
// The list is generated at runtime from Intl.supportedValuesOf('timeZone'), so it
// always matches the tzdata shipped with the running Thunderbird and never needs
// to be maintained by hand.

import './tom-select.base.js';
import { setTomSelectBorder } from '../../js/mzta-utils.js';

// Used only when Intl.supportedValuesOf() is unavailable. Includes the zones that
// were hardcoded before this module existed, plus one zone per fractional offset
// so that those offsets are reachable even on the fallback path.
const FALLBACK_TIMEZONES = [
  'Pacific/Midway', 'Pacific/Honolulu', 'Pacific/Marquesas', 'America/Anchorage',
  'America/Los_Angeles', 'America/Denver', 'America/Mexico_City', 'America/New_York',
  'America/Caracas', 'America/St_Johns', 'America/Sao_Paulo', 'Atlantic/South_Georgia',
  'Atlantic/Azores', 'Europe/London', 'Europe/Rome', 'Africa/Johannesburg',
  'Europe/Moscow', 'Asia/Tehran', 'Asia/Dubai', 'Asia/Kabul', 'Asia/Karachi',
  'Asia/Calcutta', 'Asia/Katmandu', 'Asia/Dhaka', 'Asia/Rangoon', 'Asia/Bangkok',
  'Asia/Shanghai', 'Australia/Eucla', 'Asia/Tokyo', 'Australia/Adelaide',
  'Australia/Sydney', 'Australia/Lord_Howe', 'Pacific/Noumea', 'Pacific/Fiji',
  'Pacific/Chatham', 'Pacific/Tongatapu', 'Pacific/Kiritimati',
];

let _timezoneOptions = null;

// Returns the zone's current UTC offset as "+05:30" / "-03:30", or null if the
// engine rejects the zone id. Intl returns "GMT+05:30", and a bare "GMT" for zero.
function getOffsetString(timezone, referenceDate) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    }).formatToParts(referenceDate);
    const name = parts.find(part => part.type === 'timeZoneName');
    if (!name) return null;
    const offset = name.value.replace(/^GMT/, '');
    return offset === '' ? '+00:00' : offset;
  } catch (e) {
    return null;
  }
}

// "+05:30" => 330, "-03:30" => -210. Used for sorting only.
function offsetToMinutes(offset) {
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10));
}

/**
 * The full timezone list, sorted by current UTC offset and then by id.
 * Each entry is {value, text, offsetMinutes}, where value is a plain IANA id and
 * text is the label shown to the user, e.g. "(UTC+05:30) Asia/Calcutta".
 * The result is memoized: building it formats a date once per zone.
 */
export function getTimezoneOptions() {
  if (_timezoneOptions) return _timezoneOptions;

  const zones = (typeof Intl.supportedValuesOf === 'function')
    ? Intl.supportedValuesOf('timeZone')
    : FALLBACK_TIMEZONES;

  // A single reference date for every zone, so all the offsets in the list are
  // consistent with each other. Offsets are DST dependent, so they are computed
  // for the current date rather than hardcoded.
  const now = new Date();

  _timezoneOptions = zones.reduce((acc, timezone) => {
    const offset = getOffsetString(timezone, now);
    if (offset !== null) {
      acc.push({
        value: timezone,
        text: '(UTC' + offset + ') ' + timezone,
        offsetMinutes: offsetToMinutes(offset),
      });
    }
    return acc;
  }, []).sort((a, b) => (a.offsetMinutes - b.offsetMinutes) || a.value.localeCompare(b.value));

  return _timezoneOptions;
}

/**
 * Appends the timezone options to a <select>, keeping any option already there
 * (the empty one, which represents "no timezone enforced"). Does nothing if the
 * select has already been populated.
 */
export function populateTimezoneSelect(select) {
  if (!select || select.dataset.tzPopulated) return;

  const fragment = document.createDocumentFragment();
  for (const timezone of getTimezoneOptions()) {
    fragment.appendChild(new Option(timezone.text, timezone.value));
  }
  select.appendChild(fragment);
  select.dataset.tzPopulated = '1';
}

/**
 * Populates a timezone <select> and turns it into a searchable Tom Select, which
 * the list needs because it holds every IANA timezone. Returns the Tom Select
 * instance, or null if the select is missing or already initialized.
 */
export function initTimezoneSelect(select) {
  if (!select || select.tomselect) return null;

  populateTimezoneSelect(select);

  let deleting = false;
  let ts = new TomSelect(select, {
    create: false,
    maxOptions: null,   // the list is longer than the default limit
    maxItems: 1,
    closeAfterSelect: true,
    sortField: null,    // keep the offset ordering, sorting by label would not
    // Backspace/Delete clear the selection and fire `change` too, but there the
    // control must stay open and focused so the user can type a new search right
    // away. `onDelete` runs before the item is removed, so it can flag the
    // deletion for the `change` handler below.
    onDelete: function() { deleting = true; },
  });
  ts.on('change', function() {
    setTomSelectBorder(this);
    if (deleting) {
      deleting = false;
      // Keep the dropdown open with a live caret: Tom Select only shows the
      // search input while the control is focused.
      this.open();
      this.control_input.focus();
      return;
    }
    // Drop the focus right after the selection, so the search input is
    // hidden and the control goes back to its compact state immediately.
    this.blur();
  });
  if (select.value) {
    ts.setValue(select.value, true);   // silent, the border is set right below
  }
  setTomSelectBorder(ts);

  return ts;
}
