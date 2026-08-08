import { readFileSync } from 'fs';
import path from 'path';

const DATA_DIR = path.join(import.meta.dirname, '..', 'src', 'data');
const files = ['universities.js', 'admission-scores.js', 'national-lines.js', 'uni-details.js', 'uni-photos.js', 'uni-requirements.js'];

for (const f of files) {
    const c = readFileSync(path.join(DATA_DIR, f), 'utf-8');
    const exports = c.match(/export (const|function) \w+/g) || [];
    console.log(f, '|', exports.join(', '), '|', c.split('\n').length, 'lines');
}
console.log('\n--- admission-scores sample ---');
const as = readFileSync(path.join(DATA_DIR, 'admission-scores.js'), 'utf-8').split('\n').filter(l => l.trim() && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('import')).slice(0, 15);
console.log(as.join('\n'));
console.log('\n--- uni-requirements sample ---');
const ur = readFileSync(path.join(DATA_DIR, 'uni-requirements.js'), 'utf-8').split('\n').filter(l => l.trim() && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('import')).slice(0, 30);
console.log(ur.join('\n'));
