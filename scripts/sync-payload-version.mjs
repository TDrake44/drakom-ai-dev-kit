import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const packagePath = path.resolve('package.json');
const payloadPath = path.resolve('payload/v1/payload.json');
const packageManifest = JSON.parse(await readFile(packagePath, 'utf8'));
const payloadManifest = JSON.parse(await readFile(payloadPath, 'utf8'));

if (typeof packageManifest.version !== 'string' || packageManifest.version.length === 0) {
  throw new Error(`Missing package version in ${packagePath}.`);
}
if (typeof payloadManifest.kitVersion !== 'string') {
  throw new Error(`Missing kitVersion in ${payloadPath}.`);
}

if (payloadManifest.kitVersion !== packageManifest.version) {
  payloadManifest.kitVersion = packageManifest.version;
  await writeFile(payloadPath, `${JSON.stringify(payloadManifest, null, 2)}\n`, 'utf8');
}
