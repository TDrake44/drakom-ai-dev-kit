import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const payloadRoot = path.resolve(moduleDirectory, '..', 'payload', 'v1');

export interface PayloadManifest {
  schemaVersion: 1;
  kitVersion: string;
  files: Record<string, string>;
}

export interface PackagePayload {
  manifest: PayloadManifest;
  files: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadPackagePayload(): Promise<PackagePayload> {
  const manifestPath = path.join(payloadRoot, 'payload.json');
  const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.kitVersion !== 'string' ||
    !isRecord(parsed.files)
  ) {
    throw new Error(`Invalid package payload manifest: ${manifestPath}`);
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
    },
    files,
  };
}
