import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { DRAKOM_DIR, loadState, type InstallState } from './state.js';

const ignoredDirectories = new Set(['.git', 'node_modules']);
const mcpPaths = new Set([
  `${DRAKOM_DIR}/mcp-servers.yaml`,
  '.mcp.json',
  '.vscode/mcp.json',
  '.agents/mcp_config.json',
  '.codex/config.toml',
]);

export interface TargetInventory {
  root: string;
  status: 'fresh' | 'existing' | 'initialized';
  paths: string[];
  contextFiles: string[];
  skillFiles: string[];
  mcpFiles: string[];
  hasDrakomDirectory: boolean;
  contents: Record<string, string>;
  state: InstallState | null;
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
  let targetStat;
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

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      const absolutePath = path.join(directory, entry.name);
      paths.push(entry.isDirectory() ? `${relativePath}/` : relativePath);
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
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
  const hasDrakomDirectory = paths.includes(`${DRAKOM_DIR}/`);

  return {
    root,
    status: state ? 'initialized' : paths.length === 0 ? 'fresh' : 'existing',
    paths,
    contextFiles,
    skillFiles,
    mcpFiles: existingMcpFiles,
    hasDrakomDirectory,
    contents,
    state,
  };
}
