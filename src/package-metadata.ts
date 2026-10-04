import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SEMVER_REGEX } from './state.js';
import { isRecord } from './util.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

/** Root of the installed kit package, resolved from this module rather than the working directory. */
export const packageRoot = path.resolve(moduleDirectory, '..');

export interface PackageMetadata {
  name: string;
  version: string;
}

/**
 * Read the kit's own package.json, never the consumer project's.
 */
export async function loadPackageMetadata(): Promise<PackageMetadata> {
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const parsed: unknown = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  if (
    !isRecord(parsed) ||
    typeof parsed.name !== 'string' ||
    typeof parsed.version !== 'string' ||
    !SEMVER_REGEX.test(parsed.version)
  ) {
    throw new Error(`Invalid kit package metadata: ${packageJsonPath}`);
  }
  return { name: parsed.name, version: parsed.version };
}
