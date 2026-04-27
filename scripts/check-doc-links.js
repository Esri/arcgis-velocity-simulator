/**
 * Copyright 2026 Esri
 *
 * Licensed under the Apache License Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#!/usr/bin/env node
/*
  Doc-wide link checker for Markdown files.
  - Scans root README.md and all files under docs/ recursively
  - Verifies relative links resolve to existing files
  - Verifies anchors (#fragment) map to a heading in the target file
  - Skips external (http/https/mailto) links
*/

const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const targets = [];
const docsDir = path.join(repoRoot, 'docs');
const rootReadme = path.join(repoRoot, 'README.md');

if (fs.existsSync(rootReadme)) targets.push(rootReadme);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) targets.push(p);
  }
}
if (fs.existsSync(docsDir)) walk(docsDir);

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function toSlug(s) {
  // Remove inline code backticks
  s = s.replace(/`+/g, '');
  // Lowercase
  s = s.toLowerCase();
  // Remove emojis and punctuation except spaces and hyphens
  s = s.normalize('NFKD').replace(/[^a-z0-9\s-]/g, '');
  // Collapse whitespace to single hyphen
  s = s.trim().replace(/\s+/g, '-');
  // Collapse multiple hyphens
  s = s.replace(/-+/g, '-');
  return s;
}

const headingCache = new Map();
function getAnchors(filePath) {
  if (headingCache.has(filePath)) return headingCache.get(filePath);
  const content = readFileSafe(filePath) || '';
  const anchors = new Set();
  const lines = content.split('\n');
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) {
      const text = m[2];
      anchors.add(toSlug(text));
    }
  }
  headingCache.set(filePath, anchors);
  return anchors;
}

function isExternal(url) {
  return /^(https?:)?\/\//i.test(url) || /^mailto:/i.test(url) || /^tel:/i.test(url) || /^data:/i.test(url) || /^javascript:/i.test(url);
}

const linkRe = /!?\[[^\]]*\]\(([^)]+)\)/g;
let filesScanned = 0;
let linksChecked = 0;
let errors = 0;
const errorList = [];

for (const file of targets) {
  const content = readFileSafe(file);
  if (!content) continue;
  filesScanned++;
  const dir = path.dirname(file);
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    let m;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(line)) !== null) {
      const raw = m[1].trim();
      // Strip angle brackets if present <...>
      const url = raw.replace(/^<|>$/g, '');
      if (!url || isExternal(url)) continue; // skip external or empty

      // Split anchor
      let filePart = url;
      let anchor = '';
      const hashIdx = url.indexOf('#');
      if (hashIdx >= 0) {
        filePart = url.slice(0, hashIdx);
        anchor = url.slice(hashIdx + 1);
      }

      // Determine target file path
      let targetPath;
      if (!filePart || filePart === '') {
        targetPath = file; // in-file anchor
      } else {
        targetPath = path.resolve(dir, filePart);
        // If missing extension and a file with .md exists, try to resolve
        if (!fs.existsSync(targetPath)) {
          // try adding .md
          if (!path.extname(targetPath)) {
            const mdTry = targetPath + '.md';
            if (fs.existsSync(mdTry)) targetPath = mdTry;
          }
        }
      }

      linksChecked++;

      if (!fs.existsSync(targetPath)) {
        errors++;
        errorList.push(`${file}:${idx + 1} -> Missing file: ${url}`);
        continue;
      }

      if (anchor) {
        const anchors = getAnchors(targetPath);
        const slug = toSlug(anchor);
        if (!anchors.has(slug)) {
          errors++;
          errorList.push(`${file}:${idx + 1} -> Missing anchor: ${url} (expected '#${slug}')`);
        }
      }
    }
  });
}

if (errorList.length) {
  console.log('Broken links/anchors found:');
  for (const e of errorList) console.log(' - ' + e);
}
console.log(`\nSummary: files=${filesScanned}, links_checked=${linksChecked}, errors=${errors}`);
process.exit(errors ? 1 : 0);
