import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadPackageMetadata, packageRoot } from './package-metadata.js';
import { isRelativePath, SEMVER_REGEX } from './state.js';
import { isRecord } from './util.js';

const payloadRoot = path.join(packageRoot, 'payload', 'v1');

/** A payload file that sync installs into projects whose recorded kit version predates `addedIn`. */
export interface PayloadDefault {
  target: string;
  addedIn: string;
}

export interface PayloadManifest {
  schemaVersion: 1;
  kitVersion: string;
  files: Record<string, string>;
  defaults: Record<string, PayloadDefault>;
}

export interface PackagePayload {
  manifest: PayloadManifest;
  files: Record<string, string>;
}

export async function loadPackagePayload(): Promise<PackagePayload> {
  const manifestPath = path.join(payloadRoot, 'payload.json');
  const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.kitVersion !== 'string' ||
    !SEMVER_REGEX.test(parsed.kitVersion) ||
    !isRecord(parsed.files)
  ) {
    throw new Error(`Invalid package payload manifest: ${manifestPath}`);
  }

  const metadata = await loadPackageMetadata();
  if (parsed.kitVersion !== metadata.version) {
    throw new Error(
      `Installed kit is inconsistent: payload kitVersion ${parsed.kitVersion} does not match package version ${metadata.version}. Reinstall ${metadata.name} and retry; no changes were made.`,
    );
  }

  const manifestFiles: Record<string, string> = {};
  const files: Record<string, string> = {};
  for (const [name, relativePath] of Object.entries(parsed.files).sort(([left], [right]) => left.localeCompare(right))) {
    if (typeof relativePath !== 'string' || path.isAbsolute(relativePath) || relativePath.includes('..')) {
      throw new Error(`Invalid payload path for ${name}.`);
    }
    manifestFiles[name] = relativePath;
    files[name] = await readFile(path.join(payloadRoot, relativePath), 'utf8');
  }

  return {
    manifest: {
      schemaVersion: 1,
      kitVersion: parsed.kitVersion,
      files: manifestFiles,
      defaults: validateDefaults(parsed.defaults, manifestFiles),
    },
    files,
  };
}

/**
 * Targets are compared with inventory paths and stored in state verbatim, so they must already be
 * in the inventory's form: forward slashes, no `.` or empty segments, and no trailing slash.
 */
function isCanonicalTargetPath(target: string): boolean {
  return (
    isRelativePath(target) &&
    !target.includes('\\') &&
    !target.endsWith('/') &&
    path.posix.normalize(target) === target
  );
}

function validateDefaults(value: unknown, manifestFiles: Record<string, string>): Record<string, PayloadDefault> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error('Invalid package payload defaults: expected an object.');
  }
  const defaults: Record<string, PayloadDefault> = {};
  const targets = new Set<string>();
  for (const [name, entry] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    if (!Object.hasOwn(manifestFiles, name)) {
      throw new Error(`Invalid payload default ${name}: key is not declared in files.`);
    }
    if (!isRecord(entry) || typeof entry.target !== 'string' || !isCanonicalTargetPath(entry.target)) {
      throw new Error(`Invalid payload default ${name}: target must be a canonical, safe relative file path.`);
    }
    if (targets.has(entry.target)) {
      throw new Error(`Invalid payload default ${name}: target ${entry.target} is already declared.`);
    }
    if (typeof entry.addedIn !== 'string' || !SEMVER_REGEX.test(entry.addedIn)) {
      throw new Error(`Invalid payload default ${name}: addedIn must be a SemVer version.`);
    }
    targets.add(entry.target);
    defaults[name] = { target: entry.target, addedIn: entry.addedIn };
  }
  return defaults;
}
