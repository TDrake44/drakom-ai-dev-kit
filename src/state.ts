import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const STATE_SCHEMA_VERSION = 1;

export interface ManagedFileState {
  source: string;
  fingerprint: string;
}

export interface ManagedMcpServerState {
  sourceFingerprint: string;
  targetFingerprints: Record<string, string>;
}

export interface InstallState {
  schemaVersion: 1;
  kitVersion: string;
  features: { mcp: boolean; skillMirrors: boolean };
  managedFiles: Record<string, ManagedFileState>;
  managedBlocks?: Record<string, { fingerprint: string }>;
  managedMcpServers: Record<string, ManagedMcpServerState>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRelativePath(value: string): boolean {
  return value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..');
}

export function validateState(value: unknown, statePath = '.drakom-ai/state.json'): InstallState {
  if (!isRecord(value)) {
    throw new Error(`${statePath} must contain a JSON object.`);
  }
  if (value.schemaVersion !== STATE_SCHEMA_VERSION) {
    if (typeof value.schemaVersion === 'number' && value.schemaVersion > STATE_SCHEMA_VERSION) {
      throw new Error(
        `${statePath} uses schemaVersion ${value.schemaVersion}, which is newer than this CLI supports; upgrade drakom-ai.`,
      );
    }
    throw new Error(`${statePath} must use schemaVersion ${STATE_SCHEMA_VERSION}.`);
  }
  if (typeof value.kitVersion !== 'string' || value.kitVersion.length === 0) {
    throw new Error(`${statePath} must define a non-empty kitVersion.`);
  }
  if (
    !isRecord(value.features) ||
    typeof value.features.mcp !== 'boolean' ||
    typeof value.features.skillMirrors !== 'boolean'
  ) {
    throw new Error(`${statePath} must define boolean features.mcp and features.skillMirrors values.`);
  }
  if (!isRecord(value.managedFiles)) {
    throw new Error(`${statePath} must define managedFiles as an object.`);
  }
  const managedFiles: Record<string, ManagedFileState> = {};
  for (const [managedPath, entry] of Object.entries(value.managedFiles)) {
    if (
      !isRelativePath(managedPath) ||
      !isRecord(entry) ||
      typeof entry.source !== 'string' ||
      !isRelativePath(entry.source) ||
      typeof entry.fingerprint !== 'string' ||
      !entry.fingerprint.startsWith('sha256:')
    ) {
      throw new Error(`${statePath} has an invalid managedFiles entry for ${managedPath}.`);
    }
    managedFiles[managedPath] = { source: entry.source, fingerprint: entry.fingerprint };
  }
  let managedBlocks: Record<string, { fingerprint: string }> | undefined;
  if (value.managedBlocks !== undefined) {
    if (!isRecord(value.managedBlocks)) {
      throw new Error(`${statePath} must define managedBlocks as an object when present.`);
    }
    managedBlocks = {};
    for (const [blockName, entry] of Object.entries(value.managedBlocks)) {
      if (!isRecord(entry) || typeof entry.fingerprint !== 'string' || !entry.fingerprint.startsWith('sha256:')) {
        throw new Error(`${statePath} has an invalid managedBlocks entry for ${blockName}.`);
      }
      managedBlocks[blockName] = { fingerprint: entry.fingerprint };
    }
  }
  if (!isRecord(value.managedMcpServers)) {
    throw new Error(`${statePath} must define managedMcpServers as an object.`);
  }
  const managedMcpServers: Record<string, ManagedMcpServerState> = {};
  for (const [serverName, entry] of Object.entries(value.managedMcpServers)) {
    if (
      !isRecord(entry) ||
      typeof entry.sourceFingerprint !== 'string' ||
      !entry.sourceFingerprint.startsWith('sha256:') ||
      !isRecord(entry.targetFingerprints)
    ) {
      throw new Error(`${statePath} has an invalid managedMcpServers entry for ${serverName}.`);
    }
    const targetFingerprints: Record<string, string> = {};
    for (const [targetPath, fingerprint] of Object.entries(entry.targetFingerprints)) {
      if (!isRelativePath(targetPath) || typeof fingerprint !== 'string' || !fingerprint.startsWith('sha256:')) {
        throw new Error(`${statePath} has an invalid target fingerprint for ${serverName}.`);
      }
      targetFingerprints[targetPath] = fingerprint;
    }
    managedMcpServers[serverName] = { sourceFingerprint: entry.sourceFingerprint, targetFingerprints };
  }

  const state: InstallState = {
    schemaVersion: 1,
    kitVersion: value.kitVersion,
    features: { mcp: value.features.mcp, skillMirrors: value.features.skillMirrors },
    managedFiles,
    managedMcpServers,
  };
  if (managedBlocks !== undefined) {
    state.managedBlocks = managedBlocks;
  }
  return state;
}

export async function loadState(root: string): Promise<InstallState | null> {
  const statePath = path.join(root, '.drakom-ai', 'state.json');
  let source;
  try {
    source = await readFile(statePath, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`${statePath} must contain valid JSON.`);
  }
  return validateState(parsed, statePath);
}

export function serializeState(state: InstallState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}
