import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const manifestPath = path.join(publicDir, 'manifest.webmanifest');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const required = ['name', 'short_name', 'start_url', 'scope', 'display', 'icons'];
for (const field of required) {
  if (!manifest[field]) throw new Error(`Manifest alanı eksik: ${field}`);
}

for (const size of ['192x192', '512x512']) {
  const icon = manifest.icons.find((item) => item.sizes === size && item.purpose === 'any');
  if (!icon) throw new Error(`Gerekli PWA simgesi eksik: ${size}`);
  const iconPath = path.join(publicDir, icon.src.replace(/^\//, ''));
  await stat(iconPath);

  const png = await readFile(iconPath);
  if (png.toString('ascii', 1, 4) !== 'PNG') throw new Error(`Simge PNG değil: ${icon.src}`);
  const [expectedWidth, expectedHeight] = size.split('x').map(Number);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`Simge boyutu yanlış: ${icon.src} (${width}x${height})`);
  }
}

const maskable = manifest.icons.find((item) => item.purpose === 'maskable');
if (!maskable) throw new Error('Maskelenebilir uygulama simgesi eksik');
await stat(path.join(publicDir, maskable.src.replace(/^\//, '')));

await Promise.all([
  stat(path.join(publicDir, 'sw.js')),
  stat(path.join(publicDir, 'offline.html'))
]);

const index = await readFile(path.join(root, 'index.html'), 'utf8');
if (!index.includes('rel="manifest"')) throw new Error('index.html manifest bağlantısı eksik');

const entry = await readFile(path.join(root, 'index.tsx'), 'utf8');
if (!entry.includes("serviceWorker.register('/sw.js')")) throw new Error('Servis çalışanı kaydı eksik');

console.log('PWA hazırlığı tamam: manifest, simgeler, servis çalışanı ve çevrimdışı sayfası mevcut.');
