import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/data/admission-scores.js';
let content = readFileSync(FILE, 'utf8');
let added = 0, fixed = 0;

function findUniEnd(str, uniName) {
  const pattern = `  ${uniName}: {`;
  const start = str.indexOf(pattern);
  if (start === -1) return -1;
  const openIdx = str.indexOf('{', start);
  let depth = 1, i = openIdx + 1;
  while (depth > 0 && i < str.length) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') depth--;
    i++;
  }
  return i - 1;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

function processUni(uniName, entries) {
  // Re-find each time to handle shifts
  const pattern = `  ${uniName}: {`;
  const start = content.indexOf(pattern);
  if (start === -1) { console.log(`  NOT FOUND: ${uniName}`); return; }

  // Find block boundaries
  const openIdx = content.indexOf('{', start + pattern.length);
  let depth = 1, i = openIdx + 1;
  while (depth > 0 && i < content.length) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') depth--;
    i++;
  }
  const closeIdx = i - 1;
  const block = content.slice(openIdx + 1, closeIdx);

  let newEntries = '';
  for (const [key, score, forceUpdate] of entries) {
    const escaped = escapeRe(key);
    const keyRegex = new RegExp(`'${escaped}':\\s*\\{`);

    if (keyRegex.test(block)) {
      // Key exists
      const entryMatch = block.match(new RegExp(`'${escaped}':\\s*\\{([^}]*)\\}`,'s'));
      if (entryMatch) {
        const inner = entryMatch[1];
        const scoreMatch = inner.match(/2025:\s*(\d+)/);
        if (scoreMatch) {
          const curScore = parseInt(scoreMatch[1]);
          if (curScore === score) {
            console.log(`  SKIP:  ${uniName} -> ${key}: ${score} (matches)`);
            continue;
          }
          if (!forceUpdate) {
            console.log(`  CONFLICT: ${uniName} -> ${key}: has ${curScore}, want ${score} (use force=true)`);
            continue;
          }
          // Replace existing score
          const oldEntry = entryMatch[0];
          const newInner = inner.replace(/2025:\s*\d+/, `2025: ${score}`);
          const newEntry = `'${key}': {${newInner}}`;
          content = content.replace(oldEntry, newEntry);
          console.log(`  FIXED: ${uniName} -> ${key}: ${curScore} → ${score}`);
          fixed++;
          continue;
        }
        // Has entry but no 2025 — add 2025
        const oldEntry = entryMatch[0];
        const closeBrace = entryMatch[0].lastIndexOf('}');
        const newEntry = entryMatch[0].slice(0, closeBrace) + `2025: ${score},\n    }`;
        content = content.replace(oldEntry, newEntry);
        console.log(`  ADDED yr: ${uniName} -> ${key}: ${score}`);
        added++;
        continue;
      }
    }
    // New entry
    newEntries += `    '${key}': {\n      2025: ${score},\n    },\n`;
    console.log(`  ADDED: ${uniName} -> ${key}: ${score}`);
    added++;
  }

  if (newEntries) {
    // Recalculate closeIdx after content modifications
    const p2 = `  ${uniName}: {`;
    const s2 = content.indexOf(p2);
    const o2 = content.indexOf('{', s2 + p2.length);
    let d2 = 1, j = o2 + 1;
    while (d2 > 0 && j < content.length) {
      if (content[j] === '{') d2++;
      else if (content[j] === '}') d2--;
      j++;
    }
    content = content.slice(0, j - 1) + newEntries + content.slice(j - 1);
  }
}

// FILE ORDER (by line number), VERIFIED data only
const uniData = [
  // 北京交通大学 - 官方公告 verified, no force since our data is close
  { name: '北京交通大学', entries: [
    ['工学-计算机科学与技术-学硕', 310, true],  // was 305
    ['电子信息/机械-专硕', 305, true],          // was 310
  ]},
  // 北京邮电大学 - 知乎/官方 verified
  { name: '北京邮电大学', entries: [
    ['工学-计算机科学与技术-学硕', 331],        // matches
    ['工学-软件工程-学硕', 320, true],          // was 331, now verified 320
    ['工学-网络空间安全-学硕', 324],            // new
    ['电子信息/机械-专硕', 319, true],          // was 320, verified 319
  ]},
  // 西安电子科技大学 - 知乎/官方 verified
  { name: '西安电子科技大学', entries: [
    ['工学-计算机科学与技术-学硕', 340, true],  // was 330
    ['电子信息/机械-专硕', 325, true],          // was 345
  ]},
  // 西南交通大学 - 官方PDF verified
  { name: '西南交通大学', entries: [
    ['经济学-学硕', 350],
    ['管理学-学硕', 340],
  ]},
  // 杭州电子科技大学 - 官方 verified
  { name: '杭州电子科技大学', entries: [
    ['工学-计算机科学与技术-学硕', 285, true],  // was 318, school line is 285
    ['工学-软件工程-学硕', 275, true],          // was 285
    ['电子信息/机械-专硕', 295, true],          // was 275
    ['工学-网络空间安全-学硕', 270],            // new
  ]},
];

// Process from END to BEGINNING (reverse file order)
const fileOrder = [...uniData].reverse();
for (const uni of fileOrder) {
  processUni(uni.name, uni.entries);
}

writeFileSync(FILE, content, 'utf8');
console.log(`\nDone! ${added} added, ${fixed} fixed.`);
