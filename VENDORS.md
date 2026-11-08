<!--
Besides the file and its source, each entry can carry an optional "name" (the library's display
name, in the titles of the automatic update PRs) and an optional "changelog" (linked in those PRs),
read by .github/workflows/libs-release-check.yml. For a library with more files, the first of its
entries that has them is used.
Keep this comment free of lines starting with "file:", "source:" or a URL: the Thunderbird
webext-linter would read them as a declaration and reject the whole file.
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
