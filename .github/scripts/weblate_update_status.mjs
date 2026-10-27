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
// into <output-dir>/<lang>.svg, for the language codes listed one per line in <languages-file>
// (blank lines ignored). Node built-ins only (Node 22+). Any failed download exits with code 1.
//   node .github/scripts/weblate_update_status.mjs "https://hosted.weblate.org/widget/thunderai/-/" \
//     .github/scripts/thunderai_languages.txt <path-to-micz.github.io>/static/weblate/thunderai/
// Run by the workflow thunderai-weblate-badges.yml of micz/micz.github.io, which
// .github/workflows/update-weblate-badges.yml starts on every stable release.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [baseUrl, languagesFile, outputDir] = process.argv.slice(2);

async function run() {
  try {
    const languages = (await readFile(languagesFile, 'utf8'))
      .split(/\r?\n/).map(l => l.trim()).filter(Boolean);
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

if (!baseUrl || !languagesFile || !outputDir) {
  console.error(`Usage: node ${basename(fileURLToPath(import.meta.url))} <baseurl> <languages-file> <output-dir>`);
  process.exit(1);
}

run();
