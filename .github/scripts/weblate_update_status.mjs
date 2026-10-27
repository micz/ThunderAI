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

// Downloads the Weblate translation status badge of each language: <baseurl><lang>/svg-badge.svg
// into <output-dir>/<lang>.svg, for every directory of <locales-dir> that has a messages.json,
// except en (the source language). The directory name is the code, unchanged (pt-br, zh_Hans).
// Node built-ins only (Node 22+). Any failed download exits with code 1.
//   node .github/scripts/weblate_update_status.mjs "https://hosted.weblate.org/widget/thunderai/-/" \
//     _locales <path-to-micz.github.io>/static/weblate/thunderai/
// Run by the workflow thunderai-weblate-badges.yml of micz/micz.github.io, which
// .github/workflows/update-weblate-badges.yml starts on every stable release.

import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [baseUrl, localesDir, outputDir] = process.argv.slice(2);

async function run() {
  try {
    const languages = (await readdir(localesDir, { withFileTypes: true }))
      .filter(d => d.isDirectory() && d.name !== 'en' && existsSync(join(localesDir, d.name, 'messages.json')))
      .map(d => d.name).sort();
    if (languages.length === 0) throw new Error(`no locale directories in ${localesDir}`);
    await mkdir(outputDir, { recursive: true });
    for (const lang of languages) {
      const url = `${baseUrl}${lang}/svg-badge.svg`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      await writeFile(join(outputDir, `${lang}.svg`), Buffer.from(await response.arrayBuffer()));
      console.log(`${lang}.svg downloaded`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (!baseUrl || !localesDir || !outputDir) {
  console.error(`Usage: node ${basename(fileURLToPath(import.meta.url))} <baseurl> <locales-dir> <output-dir>`);
  process.exit(1);
}

run();
