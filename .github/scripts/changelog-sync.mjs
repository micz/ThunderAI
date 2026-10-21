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

// Regenerates CHANGELOG.md from options/mzta-release-notes.html, the one source of the release
// notes: the content of #miczRelNotes after its <h1>, without the page's indentation, under the
// Markdown heading shown on GitHub. Node built-ins only, run from anywhere:
//   node .github/scripts/changelog-sync.mjs   (or `npm run changelog`)
// Run by .github/workflows/changelog-sync.yml on every push that touches the release notes.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourcePath = join(root, 'options', 'mzta-release-notes.html');
const targetPath = join(root, 'CHANGELOG.md');

const HEADING = ' # ![ThunderAI icon](images/icon-32px.png "ThunderAI") ThunderAI Release Notes';

const source = readFileSync(sourcePath, 'utf8');
const eol = source.includes('\r\n') ? '\r\n' : '\n';

const match = source.replace(/\r\n/g, '\n')
  .match(/<div id="miczRelNotes"><h1>[^<]*<\/h1>\n([\s\S]*?)\n\s*<\/div>\s*<script/);
if (!match) {
  console.error(`changelog-sync: #miczRelNotes not found in ${sourcePath}, CHANGELOG.md left as it is.`);
  process.exit(1);
}

// Versions and their lists at the margin, the items indented by two spaces.
const lines = match[1].split('\n')
  .map(line => line.trim())
  .filter(line => line !== '')
  .map(line => /^(<h2>|<\/?ul>)/.test(line) ? line : `  ${line}`);

const changelog = [HEADING, '', '', ...lines, ''].join(eol);

let current = '';
try {
  current = readFileSync(targetPath, 'utf8');
} catch {}

if (current === changelog) {
  console.log('changelog-sync: CHANGELOG.md already in line with the release notes.');
} else {
  writeFileSync(targetPath, changelog, 'utf8');
  console.log('changelog-sync: CHANGELOG.md regenerated from the release notes.');
}
