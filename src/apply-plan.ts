import { lstat, mkdir, readdir, readFile, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DRAKOM_DIR } from './constants.js';
import type { OperationPlan } from './operation-plan.js';

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function validatePathContainment(root: string, relativePath: string): Promise<string> {
  const absolutePath = path.resolve(root, relativePath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Operation path escapes the target: ${relativePath}`);
  }

  const realRoot = await realpath(root);
  const rel = path.relative(root, absolutePath);
  const segments = rel ? rel.split(path.sep) : [];
  let current = root;

  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      await lstat(current);
      const realCurrent = await realpath(current);
      if (realCurrent !== realRoot && !realCurrent.startsWith(`${realRoot}${path.sep}`)) {
        throw new Error(`Operation path escapes the target through a symlink: ${relativePath}`);
      }
    } catch (error) {
      if (isMissing(error)) {
        break;
      }
      throw error;
    }
  }

  return absolutePath;
}

async function pathType(absolutePath: string): Promise<'directory' | 'file' | 'absent'> {
  try {
    const value = await lstat(absolutePath);
    return value.isDirectory() ? 'directory' : 'file';
  } catch (error) {
    if (isMissing(error)) {
      return 'absent';
    }
    throw error;
  }
}

export interface ApplyResult {
  created: string[];
  updated: string[];
  deleted: string[];
  merged: string[];
}

/**
 * Apply a fully preflighted plan. State is required to be the final mutation.
 */
export async function applyPlan(plan: OperationPlan): Promise<ApplyResult> {
  if (plan.hasConflicts) {
    throw new Error('Cannot apply a plan that contains conflicts.');
  }
  const mutations = plan.operations.filter(({ action }) =>
    action === 'mkdir' || action === 'create' || action === 'update' || action === 'delete' || action === 'merge',
  );
  const stateIndex = mutations.findIndex(({ path: targetPath }) => targetPath === `${DRAKOM_DIR}/state.json`);
  if (stateIndex !== -1 && stateIndex !== mutations.length - 1) {
    throw new Error('Invalid operation plan: state.json must be written last.');
  }

  for (const operation of mutations) {
    const absolutePath = await validatePathContainment(plan.root, operation.path);
    const currentType = await pathType(absolutePath);
    if (operation.action === 'mkdir') {
      if (currentType !== 'absent' && currentType !== 'directory') {
        throw new Error(`Preflight failed: ${operation.path} is not a directory.`);
      }
    } else if (operation.action === 'create') {
      if (currentType !== 'absent') {
        throw new Error(`Preflight failed: ${operation.path} now exists; rerun ${plan.command}.`);
      }
    } else if (operation.action === 'update' || operation.action === 'merge') {
      if (currentType !== 'file' || operation.before === undefined) {
        throw new Error(`Preflight failed: ${operation.path} cannot be updated safely.`);
      }
      const currentContent = await readFile(absolutePath, 'utf8');
      if (currentContent !== operation.before) {
        throw new Error(`Preflight failed: ${operation.path} changed after inspection; rerun ${plan.command}.`);
      }
    } else if (operation.action === 'delete') {
      if (currentType !== 'file' || operation.before === undefined) {
        throw new Error(`Preflight failed: ${operation.path} cannot be deleted safely.`);
      }
      const currentContent = await readFile(absolutePath, 'utf8');
      if (currentContent !== operation.before) {
        throw new Error(`Preflight failed: ${operation.path} changed after inspection; rerun ${plan.command}.`);
      }
    }
  }

  const createdFiles: string[] = [];
  const createdDirectories: string[] = [];
  const mergedFiles: Array<{ path: string; content: string }> = [];
  const updatedFiles: Array<{ path: string; content: string }> = [];
  const deletedFiles: Array<{ path: string; content: string }> = [];
  let temporaryCounter = 0;

  async function ensureDirectory(directory: string): Promise<void> {
    await validatePathContainment(plan.root, path.relative(plan.root, directory));
    const missing: string[] = [];
    let cursor = directory;
    while (cursor !== plan.root && (await pathType(cursor)) === 'absent') {
      missing.push(cursor);
      cursor = path.dirname(cursor);
    }
    await mkdir(directory, { recursive: true });
    createdDirectories.push(...missing.reverse());
  }

  try {
    for (const operation of mutations) {
      const absolutePath = await validatePathContainment(plan.root, operation.path);
      if (operation.action === 'mkdir') {
        if ((await pathType(absolutePath)) === 'absent') {
          await ensureDirectory(absolutePath);
        }
      } else if (operation.action === 'create') {
        await ensureDirectory(path.dirname(absolutePath));
        await writeFile(absolutePath, operation.content ?? '', { encoding: 'utf8', flag: 'wx' });
        createdFiles.push(absolutePath);
      } else if (operation.action === 'update' || operation.action === 'merge') {
        const previousContent = operation.before ?? '';
        const temporaryPath = path.join(
          path.dirname(absolutePath),
          `.${path.basename(absolutePath)}.${DRAKOM_DIR.replace(/^\./, '')}-${process.pid}-${temporaryCounter}.tmp`,
        );
        temporaryCounter += 1;
        await writeFile(temporaryPath, operation.content ?? '', { encoding: 'utf8', flag: 'wx' });
        await rename(temporaryPath, absolutePath);
        if (operation.action === 'update') {
          updatedFiles.push({ path: absolutePath, content: previousContent });
        } else {
          mergedFiles.push({ path: absolutePath, content: previousContent });
        }
      } else if (operation.action === 'delete') {
        const previousContent = operation.before ?? '';
        await unlink(absolutePath);
        deletedFiles.push({ path: absolutePath, content: previousContent });
        const parentDir = path.dirname(absolutePath);
        try {
          const remaining = await readdir(parentDir);
          if (remaining.length === 0) {
            await rmdir(parentDir);
          }
        } catch {
          // Parent dir cleanup is best-effort
        }
      }
    }
  } catch (error) {
    for (const updated of updatedFiles.reverse()) {
      await writeFile(updated.path, updated.content, 'utf8');
    }
    for (const merged of mergedFiles.reverse()) {
      await writeFile(merged.path, merged.content, 'utf8');
    }
    for (const deleted of deletedFiles.reverse()) {
      await ensureDirectory(path.dirname(deleted.path));
      await writeFile(deleted.path, deleted.content, 'utf8');
    }
    for (const createdFile of createdFiles.reverse()) {
      try {
        await unlink(createdFile);
      } catch (rollbackError) {
        if (!isMissing(rollbackError)) {
          throw rollbackError;
        }
      }
    }
    for (const createdDirectory of createdDirectories.reverse()) {
      try {
        await rmdir(createdDirectory);
      } catch (rollbackError) {
        if (
          !isMissing(rollbackError) &&
          !(typeof rollbackError === 'object' && rollbackError !== null && 'code' in rollbackError && rollbackError.code === 'ENOTEMPTY')
        ) {
          throw rollbackError;
        }
      }
    }
    throw error;
  }

  return {
    created: createdFiles.map((value) => path.relative(plan.root, value)),
    updated: updatedFiles.map(({ path: value }) => path.relative(plan.root, value)),
    deleted: deletedFiles.map(({ path: value }) => path.relative(plan.root, value)),
    merged: mergedFiles.map(({ path: value }) => path.relative(plan.root, value)),
  };
}
