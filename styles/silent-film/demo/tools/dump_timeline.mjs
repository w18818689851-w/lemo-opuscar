// timeline.js → timeline.json (for Python: score / mix / cue check)
import fs from 'fs'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const D = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tl = await import(pathToFileURL(path.join(D, 'timeline.js')).href);
fs.writeFileSync(path.join(D, 'timeline.json'), JSON.stringify({ DUR: tl.DUR, SEC: tl.SEC, HIT: tl.HIT }, null, 1));
console.log('timeline.json', tl.DUR.toFixed(3), 's');
