<!--
One entry per vendored file, separated by a blank line:
  file:      the file path in the repository
  source:    the exact version URL it is downloaded from
  name:      (optional) the library's display name, used in the titles of the automatic update PRs
  changelog: (optional) the library's change log, linked in the automatic update PRs
The npm sources (".../npm/<package>@<version>/...") are checked daily for new versions by
.github/workflows/libs-release-check.yml; for a library with more files, name and changelog are
read from its first entry that has them.
-->

file: pages\_lib\list.js
source: https://raw.githubusercontent.com/javve/list.js/v2.3.1/dist/list.js
name: List.js
changelog: https://github.com/javve/list.js/blob/master/CHANGELOG.md

file: pages\_lib\tom-select.base.js
source: https://cdn.jsdelivr.net/npm/tom-select@v2.6.2/dist/js/tom-select.base.js
name: Tom Select
changelog: https://github.com/orchidjs/tom-select/releases

file: pages\_lib\tom-select.default.min.css
source: https://cdn.jsdelivr.net/npm/tom-select@v2.6.2/dist/css/tom-select.default.min.css
name: Tom Select
changelog: https://github.com/orchidjs/tom-select/releases

file: js\lib\diff.js
source: https://cdn.jsdelivr.net/npm/diff@9.0.0/dist/diff.js
name: jsdiff
changelog: https://github.com/kpdecker/jsdiff/blob/master/release-notes.md

file: api_webchat/markdown-it.min.js
source: https://cdn.jsdelivr.net/npm/markdown-it@15.0.3/dist/browser/markdown-it.umd.min.js
name: markdown-it
changelog: https://github.com/markdown-it/markdown-it/blob/master/CHANGELOG.md

file: js\lib\idb.js
source: https://cdn.jsdelivr.net/npm/idb@8.0.4/build/index.js
name: idb
changelog: https://github.com/jakearchibald/idb/blob/main/CHANGELOG.md
