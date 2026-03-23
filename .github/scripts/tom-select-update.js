const fs = require('fs');
const https = require('https');
const path = require('path');

// --- Utility: fetch URL following redirects ---
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ThunderAI-vendor-updater' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

// --- Read VENDORS.md ---
const vendorsPath = 'VENDORS.md';
const content = fs.readFileSync(vendorsPath, 'utf8');

// --- Find all entries: file + source ---
const entryRegex = /file:\s*(.+?)\r?\nsource:\s*(https?:\/\/.+)/g;
const entries = [];
let match;
while ((match = entryRegex.exec(content)) !== null) {
  entries.push({
    file: match[1].trim(),
    source: match[2].trim(),
  });
}

// --- Filter tom-select entries only ---
const filteredEntries = entries.filter(e => e.file.toLowerCase().includes('tom-select'));

if (filteredEntries.length === 0) {
  console.log('No entries found in VENDORS.md');
  process.exit(0);
}

// --- Main ---
(async () => {
  let hasErrors = false;

  for (const entry of filteredEntries) {
    const filePath = entry.file.replace(/\\/g, '/');
    console.log(`\nProcessing: ${filePath}`);
    console.log(`  Source: ${entry.source}`);

    // Create directory if it doesn't exist
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`  → Directory created: ${dir}`);
    }

    // Download file
    try {
      const res = await fetchUrl(entry.source);
      if (res.status === 200) {
        fs.writeFileSync(filePath, res.body);
        console.log(`  ✓ File updated (${res.body.length} bytes)`);
      } else {
        console.error(`  ✗ Download failed: HTTP ${res.status}`);
        hasErrors = true;
      }
    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    console.error('\nSome files were not updated.');
    process.exit(1);
  } else {
    console.log('\nAll files updated successfully.');
  }
})();