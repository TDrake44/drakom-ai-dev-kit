import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { DRAKOM_DIR } from './constants.js';
import type { TargetInventory } from './inspect-target.js';
import { createOnceSources, payloadContentBySource, type ManagedFileResolutions } from './operation-plan.js';
import type { PackagePayload } from './package-payload.js';
import { matchesFingerprint, sameText } from './util.js';

const mcpClientFiles = new Set(['.mcp.json', '.vscode/mcp.json', '.agents/mcp_config.json', '.codex/config.toml']);

type OptionName = '--accept' | '--release';

/**
 * Turn a path typed for `--accept` or `--release` into the root-relative POSIX form used in plans
 * and state. Relative paths are taken from the target root; the platform's native separators and an
 * absolute path inside the target are accepted too.
 */
export function normalizeTargetRelativePath(
  value: string,
  root: string,
  option: OptionName,
  pathApi: path.PlatformPath = path,
): string {
  const relative = pathApi.relative(root, pathApi.resolve(root, value));
  if (relative === '') {
    throw new Error(`${option} ${value}: this is the target directory itself, not a kit-managed file.`);
  }
  if (relative === '..' || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) {
    throw new Error(
      `${option} ${value}: the path is outside the target. Give a path relative to the target, as printed in the plan.`,
    );
  }
  return relative.split(pathApi.sep).join('/');
}

function describeUnmanagedPath(inventory: TargetInventory, managedPath: string): string {
  const state = inventory.state;
  if (managedPath.startsWith('.claude/skills/') || Object.hasOwn(state?.managedSkillMirrors ?? {}, managedPath)) {
    return 'it is a generated Claude skill mirror, which always follows the canonical skill in .agents/skills/. Edit or resolve the canonical skill instead';
  }
  if (Object.keys(state?.managedBlocks ?? {}).some((blockKey) => blockKey.split('#')[0] === managedPath)) {
    return 'the kit manages only a marked block inside it, not the whole file. Restore the block between the drakom-ai markers; the rest of the file is already yours';
  }
  if (mcpClientFiles.has(managedPath)) {
    return `it is an MCP client file generated from ${DRAKOM_DIR}/mcp-servers.yaml. Change the registry, or resolve the server entry named in the conflict`;
  }
  return `it is not a kit-managed file, so it is already project-owned. Kit-managed files are the ones recorded under managedFiles in ${DRAKOM_DIR}/state.json`;
}

/** Resolve symlinks in the part of a path that exists; a missing tail is kept as typed. */
async function realpathOfExistingPart(absolutePath: string, pathApi: path.PlatformPath): Promise<string> {
  const missing: string[] = [];
  let cursor = absolutePath;
  for (;;) {
    try {
      return pathApi.join(await realpath(cursor), ...missing);
    } catch {
      const parent = pathApi.dirname(cursor);
      if (parent === cursor) return absolutePath;
      missing.unshift(pathApi.basename(cursor));
      cursor = parent;
    }
  }
}

/**
 * Normalise an option path. An absolute path that looks outside the target is compared again with
 * symlinks resolved on both sides, so `/tmp/x` and `/private/tmp/x` name the same file.
 */
async function normalizeOptionPath(
  value: string,
  root: string,
  option: OptionName,
  pathApi: path.PlatformPath,
): Promise<string> {
  try {
    return normalizeTargetRelativePath(value, root, option, pathApi);
  } catch (error) {
    if (!pathApi.isAbsolute(value)) throw error;
    try {
      return normalizeTargetRelativePath(
        await realpathOfExistingPart(value, pathApi),
        await realpathOfExistingPart(root, pathApi),
        option,
        pathApi,
      );
    } catch {
      throw error;
    }
  }
}

/** A managed file the user probably meant: the same path read from the current directory, or in another letter case. */
function suggestManagedPath(
  value: string,
  managedPath: string,
  managedFiles: Record<string, unknown>,
  root: string,
  cwd: string,
  pathApi: path.PlatformPath,
): string {
  if (!pathApi.isAbsolute(value)) {
    const fromCwd = pathApi.relative(root, pathApi.resolve(cwd, value)).split(pathApi.sep).join('/');
    if (Object.hasOwn(managedFiles, fromCwd)) {
      return ` Did you mean ${fromCwd}? Paths are relative to the target, not the current directory.`;
    }
  }
  const sameLetters = Object.keys(managedFiles).find((known) => known.toLowerCase() === managedPath.toLowerCase());
  return sameLetters === undefined ? '' : ` Did you mean ${sameLetters}? Paths are case-sensitive.`;
}

export interface ManagedFileOptions {
  accept: readonly string[];
  release: readonly string[];
  /** The directory the command was run from; used only to suggest the path the user meant. */
  cwd?: string;
}

/**
 * Validate the paths given to `sync --accept` and `sync --release` against the inspected target.
 * Both options apply to kit-managed files only; anything else is an error, never a silent no-op.
 */
export async function resolveManagedFileOptions(
  inventory: TargetInventory,
  payload: PackagePayload,
  options: ManagedFileOptions,
  pathApi: path.PlatformPath = path,
): Promise<ManagedFileResolutions> {
  const managedFiles = inventory.state?.managedFiles ?? {};
  const createOnce = createOnceSources(payload);
  const payloadContent = payloadContentBySource(payload);
  const resolve = async (option: OptionName, values: readonly string[]): Promise<Set<string>> => {
    const resolved = new Set<string>();
    for (const value of values) {
      const managedPath = await normalizeOptionPath(value, inventory.root, option, pathApi);
      if (!Object.hasOwn(managedFiles, managedPath)) {
        const hint = suggestManagedPath(value, managedPath, managedFiles, inventory.root, options.cwd ?? inventory.root, pathApi);
        throw new Error(
          `${option} ${managedPath}: ${describeUnmanagedPath(inventory, managedPath)}. ${option} applies to kit-managed files only.${hint}`,
        );
      }
      resolved.add(managedPath);
    }
    return resolved;
  };

  const accept = await resolve('--accept', options.accept);
  const release = await resolve('--release', options.release);
  for (const managedPath of accept) {
    if (release.has(managedPath)) {
      throw new Error(`${managedPath} is given to both --accept and --release; choose one.`);
    }
    const entry = managedFiles[managedPath];
    if (entry === undefined) continue;
    const releaseCommand = `\`drakom-ai sync --release ${managedPath}\``;
    if (createOnce.get(managedPath) === entry.source) {
      throw new Error(
        `--accept ${managedPath}: it is a starter file that is already project-owned; sync releases its record on its own, so there is nothing to accept.`,
      );
    }
    const currentContent = inventory.contents[managedPath];
    if (currentContent === undefined) {
      throw new Error(
        `--accept ${managedPath}: the file is missing, so there is no local edit to keep. Restore it, or run ${releaseCommand} to stop managing it.`,
      );
    }
    const kitContent = payloadContent.get(entry.source);
    if (kitContent === undefined) {
      throw new Error(
        `--accept ${managedPath}: this kit version no longer ships it (source ${entry.source}), so there is no kit version to keep your edit against. Run ${releaseCommand} to keep the file as project-owned.`,
      );
    }
    if (sameText(currentContent, kitContent)) {
      throw new Error(
        `--accept ${managedPath}: the file matches the kit version, so there is no local edit to accept. Run \`drakom-ai sync\` without --accept.`,
      );
    }
    if (entry.acceptedFingerprint === undefined && matchesFingerprint(currentContent, entry.fingerprint)) {
      throw new Error(
        `--accept ${managedPath}: the file has no local edit to accept; it is only behind the kit version. Run \`drakom-ai sync\` to take the update, or ${releaseCommand} to stop managing it.`,
      );
    }
  }
  return { accept, release };
}
