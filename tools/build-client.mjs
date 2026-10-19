import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
await build({ entryPoints: ['client/icons.js'], bundle: true, minify: true, format: 'iife', target: 'es2022', outfile: '无限画布/vendor-icons.js', legalComments: 'linked' });
await build({ entryPoints: ['client/media-encoder.js'], bundle: true, minify: true, format: 'iife', target: 'es2022', outfile: '无限画布/media-encoder.js', legalComments: 'linked' });
await build({ entryPoints: ['client/scene3d.js'], bundle: true, minify: true, format: 'iife', target: 'es2022', outfile: '无限画布/scene3d.js', legalComments: 'linked' });
await build({ entryPoints: ['client/login-scene.js'], bundle: true, minify: true, format: 'iife', target: 'es2022', outfile: '无限画布/login-scene.js', legalComments: 'linked' });
const notices = await Promise.all([
    ['Lucide', 'node_modules/lucide/LICENSE'],
    ['Three.js', 'node_modules/three/LICENSE'],
    ['Inter font', 'client/licenses/inter-OFL.txt'],
    ['fix-webm-duration (fix and parser)', 'client/licenses/fix-webm-duration.txt'],
    ['tslib', 'node_modules/tslib/LICENSE.txt'],
    ['tslib copyright', 'node_modules/tslib/CopyrightNotice.txt']
].map(async ([name, file]) => `${name}\n${await readFile(file, 'utf8')}`));
await writeFile('无限画布/THIRD_PARTY_NOTICES.txt', notices.join('\n\n--------------------\n\n'));
