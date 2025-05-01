/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2025  Mic (m@micz.it)

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
// Firefox 115 and, consequently, Thunderbird 115 are not compatible with Intl.Segmenter.
// ChatGPT is using Intl.Segmenter, so we have to do something about it or it won't work...

// console.log("[ThunderAI] Intl.Segmenter: " + Intl.Segmenter);

(function() {
    if('Segmenter' in Intl){
        // console.log('[ThunderAI] TB128+ detected. Intl.Segmenter is already supported.');
        return;
    }
    // Creates a <script> element to inject polyfill.js into the page context
    const script = document.createElement('script');
    script.src = browser.runtime.getURL('js/tb115_segmenter/tb115_polyfill.js');
    script.onload = function() {
        // Remove the script once loaded for cleanup
        this.remove();
    };
    script.onerror = function() {
        console.error('[ThunderAI] Error loading Intl.Segmenter polyfill.');
    };
    (document.head || document.documentElement).appendChild(script);
})();



async function isThunderbird128OrGreater(){
    try {
      const info = await browser.runtime.getBrowserInfo();
      const version = info.version;
      return compareThunderbirdVersions(version, '128.0') >= 0;
    } catch (error) {
      console.error('[ThunderAI] Error retrieving browser information:', error);
      return false;
    }
  }
  
  function compareThunderbirdVersions(v1, v2) {
    const v1parts = v1.split('.').map(Number);
    const v2parts = v2.split('.').map(Number);
  
    for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
      const v1part = v1parts[i] || 0;
      const v2part = v2parts[i] || 0;
      if (v1part > v2part) return 1;
      if (v1part < v2part) return -1;
    }
    return 0;
  }