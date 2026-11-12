import { lstat, readFile, readdir, readlink, realpath } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import path from 'node:path';

import { DRAKOM_DIR, loadState, type InstallState } from './state.js';

const ignoredDirectories = new Set(['.git', 'node_modules']);
// Build outputs are skipped for speed, but not inside AI context roots, where a skill may be named "build".
const buildOutputDirectories = new Set([
  '.venv',
  'venv',
  'target',
  'build',
  'dist',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  'vendor',
]);
const contextRoots = [`${DRAKOM_DIR}/`, '.agents/', '.claude/'];

function isSkippedDirectory(name: string, relativePath: string): boolean {
  if (ignoredDirectories.has(name)) return true;
  return buildOutputDirectories.has(name) && !contextRoots.some((root) => relativePath.startsWith(root));
}
const mcpPaths = new Set([
  `${DRAKOM_DIR}/mcp-servers.yaml`,
  '.mcp.json',
  '.vscode/mcp.json',
  '.agents/mcp_config.json',
  '.codex/config.toml',
]);

/** A symbolic link found during inspection; links are recorded but never walked or read through. */
export interface SymlinkEntry {
  /** The link text exactly as stored, for messages. */
  target: string;
  /** Where the link resolves: inside the root, outside it, or nowhere. */
  status: 'inside' | 'outside' | 'broken';
  /**
   * POSIX root-relative path of the link's destination. For `inside`, the fully resolved real path;
   * for `broken`, the lexical destination when it stays inside the root, so planning can recognize a
   * link to a path that the plan itself creates. Null when the destination is outside the root.
   */
  resolved: string | null;
}

export interface TargetInventory {
  root: string;
  status: 'fresh' | 'existing' | 'initialized';
  paths: string[];
  pathSet: Set<string>;
  contextFiles: string[];
  skillFiles: string[];
  mcpFiles: string[];
  hasDrakomDirectory: boolean;
  contents: Record<string, string>;
  /** Symbolic links keyed by root-relative POSIX path. */
  symlinks: Record<string, SymlinkEntry>;
  state: InstallState | null;
}

function toRootRelative(root: string, absolutePath: string): string | null {
  const relative = path.relative(root, absolutePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join('/');
}

async function describeSymlink(root: string, realRoot: string, absolutePath: string): Promise<SymlinkEntry> {
  const target = await readlink(absolutePath);
  let realTarget: string;
  try {
    realTarget = await realpath(absolutePath);
  } catch {
    return {
      target,
      status: 'broken',
      resolved: toRootRelative(root, path.resolve(path.dirname(absolutePath), target)),
    };
  }
  const resolved = toRootRelative(realRoot, realTarget);
  return resolved === null ? { target, status: 'outside', resolved } : { target, status: 'inside', resolved };
}

function isContextFile(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  return (
    basename === 'AGENTS.md' ||
    basename === 'CLAUDE.md' ||
    relativePath === '.github/copilot-instructions.md' ||
    relativePath === '.cursorrules' ||
    relativePath === '.windsurfrules' ||
    relativePath.startsWith('.cursor/rules/') ||
    (relativePath.startsWith('.github/instructions/') && relativePath.endsWith('.instructions.md'))
  );
}

function isSkillFile(relativePath: string): boolean {
  return (
    relativePath.endsWith('/SKILL.md') &&
    (relativePath.startsWith('.agents/skills/') || relativePath.startsWith('.claude/skills/'))
  );
}

/**
 * Inspect a target once so later planning can remain filesystem-pure.
 */
export async function inspectTarget(targetPath: string): Promise<TargetInventory> {
  const root = path.resolve(targetPath);
  let targetStat: Stats;
  try {
    targetStat = await lstat(root);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Target path does not exist: ${root}`);
    }
    throw error;
  }
  if (!targetStat.isDirectory()) {
    throw new Error(`Target path is not a directory: ${root}`);
  }

  const paths: string[] = [];
  const contents: Record<string, string> = {};
  const symlinks: Record<string, SymlinkEntry> = {};
  const realRoot = await realpath(root);

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      const absolutePath = path.join(directory, entry.name);
      paths.push(entry.isDirectory() ? `${relativePath}/` : relativePath);
      if (entry.isSymbolicLink()) {
        symlinks[relativePath] = await describeSymlink(root, realRoot, absolutePath);
      } else if (entry.isDirectory() && !isSkippedDirectory(entry.name, relativePath)) {
        await visit(absolutePath, relativePath);
      } else if (
        entry.isFile() &&
        (isContextFile(relativePath) ||
          isSkillFile(relativePath) ||
          mcpPaths.has(relativePath) ||
          relativePath === '.gitignore' ||
          relativePath === '.worktreeinclude')
      ) {
        contents[relativePath] = await readFile(absolutePath, 'utf8');
      }
    }
  }

  await visit(root, '');
  paths.sort();
  const state = await loadState(root);
  const stateRelPath = `${DRAKOM_DIR}/state.json`;
  if (paths.includes(stateRelPath) && contents[stateRelPath] === undefined) {
    try {
      contents[stateRelPath] = await readFile(path.join(root, DRAKOM_DIR, 'state.json'), 'utf8');
    } catch {
      // Ignore
    }
  }
  if (state) {
    for (const managedPath of Object.keys(state.managedFiles)) {
      if (paths.includes(managedPath) && contents[managedPath] === undefined) {
        try {
          contents[managedPath] = await readFile(path.join(root, managedPath), 'utf8');
        } catch {
          // Ignore
        }
      }
    }
  }
  const contextFiles = paths.filter((value) => !value.endsWith('/') && isContextFile(value));
  const skillFiles = paths.filter((value) => !value.endsWith('/') && isSkillFile(value));
  const existingMcpFiles = paths.filter((value) => mcpPaths.has(value));
  const pathSet = new Set(paths);
  const hasDrakomDirectory = pathSet.has(`${DRAKOM_DIR}/`);
  const isEffectivelyEmpty =
    paths.length === 0 || (paths.length === 1 && (paths[0] === '.git/' || paths[0] === '.git'));

  return {
    root,
    status: state ? 'initialized' : isEffectivelyEmpty ? 'fresh' : 'existing',
    paths,
    pathSet,
    contextFiles,
    skillFiles,
    mcpFiles: existingMcpFiles,
    hasDrakomDirectory,
    contents,
    symlinks,
    state,
  };
}
