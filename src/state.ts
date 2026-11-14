import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { DRAKOM_DIR } from './constants.js';
import { isRecord } from './util.js';

export { DRAKOM_DIR };

export const STATE_SCHEMA_VERSION = 1;

export interface ManagedFileState {
  source: string;
  fingerprint: string;
  /**
   * Set by `sync --accept`: the fingerprint of the local content the user chose to keep. While it
   * is set, `fingerprint` is the kit's version of the file at the time of acceptance, so a CLI that
   * does not know this field sees a locally modified file and never overwrites it.
   */
  acceptedFingerprint?: string;
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
  managedSkillMirrors?: Record<string, { fingerprint: string }>;
  managedMcpServers: Record<string, ManagedMcpServerState>;
  /** Paths given to `sync --release`. The kit never installs or manages a file at them again. */
  releasedFiles?: string[];
}

export const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export interface SemVer {
  major: bigint;
  minor: bigint;
  patch: bigint;
  prerelease: string[];
}

export function parseSemVer(version: string): SemVer {
  const match = version.match(SEMVER_REGEX);
  if (!match) {
    throw new Error(`Invalid SemVer version: "${version}".`);
  }
  const major = BigInt(match[1]!);
  const minor = BigInt(match[2]!);
  const patch = BigInt(match[3]!);
  const prerelease = match[4] ? match[4].split('.') : [];
  return { major, minor, patch, prerelease };
}

export function compareVersions(left: string, right: string): number {
  const v1 = parseSemVer(left);
  const v2 = parseSemVer(right);

  if (v1.major !== v2.major) return v1.major > v2.major ? 1 : -1;
  if (v1.minor !== v2.minor) return v1.minor > v2.minor ? 1 : -1;
  if (v1.patch !== v2.patch) return v1.patch > v2.patch ? 1 : -1;

  if (v1.prerelease.length === 0 && v2.prerelease.length > 0) return 1;
  if (v1.prerelease.length > 0 && v2.prerelease.length === 0) return -1;
  if (v1.prerelease.length === 0 && v2.prerelease.length === 0) return 0;

  const maxLen = Math.max(v1.prerelease.length, v2.prerelease.length);
  for (let i = 0; i < maxLen; i++) {
    const id1 = v1.prerelease[i];
    const id2 = v2.prerelease[i];
    if (id1 === undefined) return -1;
    if (id2 === undefined) return 1;

    if (id1 === id2) continue;

    const isNum1 = /^\d+$/.test(id1);
    const isNum2 = /^\d+$/.test(id2);

    if (isNum1 && isNum2) {
      const num1 = BigInt(id1);
      const num2 = BigInt(id2);
      return num1 > num2 ? 1 : -1;
    }
    if (isNum1 && !isNum2) return -1;
    if (!isNum1 && isNum2) return 1;

    return id1 < id2 ? -1 : 1;
  }

  return 0;
}

export function isRelativePath(value: string): boolean {
  return value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..');
}

/**
 * Refuses a "__proto__" key in a name-keyed state map. Copying such an entry by assignment would
 * set the copy's prototype instead of adding the entry, so it would vanish without a trace.
 */
function assertNoReservedName(map: Record<string, unknown>, statePath: string, mapName: string): void {
  if (Object.hasOwn(map, '__proto__')) {
    throw new Error(
      `${statePath} has an entry named "__proto__" in ${mapName}; that name is reserved and cannot be recorded. Remove that entry from ${statePath}, and rename whatever it names.`,
    );
  }
}

export function validateState(value: unknown, statePath = `${DRAKOM_DIR}/state.json`): InstallState {
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
  if (!SEMVER_REGEX.test(value.kitVersion)) {
    throw new Error(`${statePath} has an invalid SemVer kitVersion: "${value.kitVersion}".`);
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
  assertNoReservedName(value.managedFiles, statePath, 'managedFiles');
  const managedFiles: Record<string, ManagedFileState> = {};
  for (const [managedPath, entry] of Object.entries(value.managedFiles)) {
    if (
      !isRelativePath(managedPath) ||
      !isRecord(entry) ||
      typeof entry.source !== 'string' ||
      !isRelativePath(entry.source) ||
      typeof entry.fingerprint !== 'string' ||
      !entry.fingerprint.startsWith('sha256:') ||
      (entry.acceptedFingerprint !== undefined &&
        (typeof entry.acceptedFingerprint !== 'string' || !entry.acceptedFingerprint.startsWith('sha256:')))
    ) {
      throw new Error(`${statePath} has an invalid managedFiles entry for ${managedPath}.`);
    }
    managedFiles[managedPath] = { source: entry.source, fingerprint: entry.fingerprint };
    if (entry.acceptedFingerprint !== undefined) {
      managedFiles[managedPath].acceptedFingerprint = entry.acceptedFingerprint;
    }
  }
  let managedBlocks: Record<string, { fingerprint: string }> | undefined;
  if (value.managedBlocks !== undefined) {
    if (!isRecord(value.managedBlocks)) {
      throw new Error(`${statePath} must define managedBlocks as an object when present.`);
    }
    assertNoReservedName(value.managedBlocks, statePath, 'managedBlocks');
    managedBlocks = {};
    for (const [blockName, entry] of Object.entries(value.managedBlocks)) {
      if (!isRecord(entry) || typeof entry.fingerprint !== 'string' || !entry.fingerprint.startsWith('sha256:')) {
        throw new Error(`${statePath} has an invalid managedBlocks entry for ${blockName}.`);
      }
      managedBlocks[blockName] = { fingerprint: entry.fingerprint };
    }
  }
  let managedSkillMirrors: Record<string, { fingerprint: string }> | undefined;
  if (value.managedSkillMirrors !== undefined) {
    if (!isRecord(value.managedSkillMirrors)) {
      throw new Error(`${statePath} must define managedSkillMirrors as an object when present.`);
    }
    assertNoReservedName(value.managedSkillMirrors, statePath, 'managedSkillMirrors');
    managedSkillMirrors = {};
    for (const [mirrorPath, entry] of Object.entries(value.managedSkillMirrors)) {
      if (
        !isRelativePath(mirrorPath) ||
        !isRecord(entry) ||
        typeof entry.fingerprint !== 'string' ||
        !entry.fingerprint.startsWith('sha256:')
      ) {
        throw new Error(`${statePath} has an invalid managedSkillMirrors entry for ${mirrorPath}.`);
      }
      managedSkillMirrors[mirrorPath] = { fingerprint: entry.fingerprint };
    }
  }
  if (!isRecord(value.managedMcpServers)) {
    throw new Error(`${statePath} must define managedMcpServers as an object.`);
  }
  assertNoReservedName(value.managedMcpServers, statePath, 'managedMcpServers');
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
    assertNoReservedName(entry.targetFingerprints, statePath, `the managedMcpServers entry for ${serverName}`);
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
  if (managedSkillMirrors !== undefined) {
    state.managedSkillMirrors = managedSkillMirrors;
  }
  if (value.releasedFiles !== undefined) {
    const releasedFiles = value.releasedFiles;
    if (
      !Array.isArray(releasedFiles) ||
      !releasedFiles.every((entry): entry is string => typeof entry === 'string' && isRelativePath(entry))
    ) {
      throw new Error(`${statePath} must define releasedFiles as a list of relative paths when present.`);
    }
    state.releasedFiles = releasedFiles;
  }
  return state;
}

export async function loadState(root: string): Promise<InstallState | null> {
  const statePath = path.join(root, DRAKOM_DIR, 'state.json');
  const displayPath = statePath.split(path.sep).join('/');
  let source: string;
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
    throw new Error(`${displayPath} must contain valid JSON.`);
  }
  return validateState(parsed, displayPath);
}

/** Serialize with a fixed key order so equal states always produce identical bytes. */
export function serializeState(state: InstallState): string {
  const ordered: InstallState = {
    schemaVersion: state.schemaVersion,
    kitVersion: state.kitVersion,
    features: state.features,
    managedFiles: state.managedFiles,
    managedMcpServers: state.managedMcpServers,
  };
  if (state.managedBlocks !== undefined) {
    ordered.managedBlocks = state.managedBlocks;
  }
  if (state.managedSkillMirrors !== undefined) {
    ordered.managedSkillMirrors = state.managedSkillMirrors;
  }
  if (state.releasedFiles !== undefined && state.releasedFiles.length > 0) {
    ordered.releasedFiles = [...new Set(state.releasedFiles)].sort();
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
