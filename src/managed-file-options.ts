import path from 'node:path';

import { DRAKOM_DIR } from './constants.js';
import type { TargetInventory } from './inspect-target.js';
import { createOnceSources, payloadContentBySource, type ManagedFileResolutions } from './operation-plan.js';
import type { PackagePayload } from './package-payload.js';

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

/**
 * Validate the paths given to `sync --accept` and `sync --release` against the inspected target.
 * Both options apply to kit-managed files only; anything else is an error, never a silent no-op.
 */
export function resolveManagedFileOptions(
  inventory: TargetInventory,
  payload: PackagePayload,
  options: { accept: readonly string[]; release: readonly string[] },
  pathApi: path.PlatformPath = path,
): ManagedFileResolutions {
  const managedFiles = inventory.state?.managedFiles ?? {};
  const createOnce = createOnceSources(payload);
  const payloadContent = payloadContentBySource(payload);
  const resolve = (option: OptionName, values: readonly string[]): Set<string> => {
    const resolved = new Set<string>();
    for (const value of values) {
      const managedPath = normalizeTargetRelativePath(value, inventory.root, option, pathApi);
      if (!Object.hasOwn(managedFiles, managedPath)) {
        throw new Error(
          `${option} ${managedPath}: ${describeUnmanagedPath(inventory, managedPath)}. ${option} applies to kit-managed files only.`,
        );
      }
      resolved.add(managedPath);
    }
    return resolved;
  };

  const accept = resolve('--accept', options.accept);
  const release = resolve('--release', options.release);
  for (const managedPath of accept) {
    if (release.has(managedPath)) {
      throw new Error(`${managedPath} is given to both --accept and --release; choose one.`);
    }
    const entry = managedFiles[managedPath];
    if (entry === undefined) continue;
    if (createOnce.get(managedPath) === entry.source) {
      throw new Error(
        `--accept ${managedPath}: it is a starter file that is already project-owned; sync releases its record on its own, so there is nothing to accept.`,
      );
    }
    const currentContent = inventory.contents[managedPath];
    if (currentContent === undefined) {
      throw new Error(
        `--accept ${managedPath}: the file is missing, so there is no local edit to keep. Restore it, or run \`drakom-ai sync --release ${managedPath}\` to stop managing it.`,
      );
    }
    const kitContent = payloadContent.get(entry.source);
    if (kitContent === undefined) {
      throw new Error(
        `--accept ${managedPath}: this kit version no longer ships it (source ${entry.source}), so there is no kit version to keep your edit against. Run \`drakom-ai sync --release ${managedPath}\` to keep the file as project-owned.`,
      );
    }
    if (currentContent === kitContent) {
      throw new Error(
        `--accept ${managedPath}: the file matches the kit version, so there is no local edit to accept. Run \`drakom-ai sync\` without --accept.`,
      );
    }
  }
  return { accept, release };
}
