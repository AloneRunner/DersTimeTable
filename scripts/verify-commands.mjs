/**
 * Doğal dil komut çözümleyicinin testini çalıştırır: npm run verify:commands
 *
 * Proje ESM olduğu için TypeScript çıktısı geçici bir klasöre CommonJS olarak
 * derlenir; oraya bırakılan küçük package.json Node'a "burası CommonJS" der.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const OUT = 'tmp_cmd';
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });

rmSync(OUT, { recursive: true, force: true });

const compile = run('npx', [
  '-y', 'tsc',
  '--module', 'commonjs',
  '--target', 'ES2022',
  '--outDir', OUT,
  '--esModuleInterop', 'true',
  '--skipLibCheck', 'true',
  '--moduleResolution', 'node',
  '--rootDir', '.',
  'services/commandParser.ts',
  'scripts/verify-command-parser.ts',
]);
if (compile.status !== 0) process.exit(compile.status ?? 1);

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/package.json`, '{"type":"commonjs"}');

const test = run('node', [`${OUT}/scripts/verify-command-parser.js`]);
rmSync(OUT, { recursive: true, force: true });
process.exit(test.status ?? 1);
