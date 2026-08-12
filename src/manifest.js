import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeManifest(siteOutputDir, manifest) {
  await fs.mkdir(siteOutputDir, { recursive: true });
  const filePath = path.join(siteOutputDir, 'manifest.json');
  await fs.writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf8');
  return filePath;
}

export async function readManifest(siteOutputDir) {
  const filePath = path.join(siteOutputDir, 'manifest.json');
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}
