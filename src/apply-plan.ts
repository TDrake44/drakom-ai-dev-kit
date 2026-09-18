import { lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { OperationPlan } from './operation-plan.js';

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function resolveTarget(root: string, relativePath: string): string {
  const absolutePath = path.resolve(root, relativePath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Operation path escapes the target: ${relativePath}`);
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

/**
 * Apply a fully preflighted plan. State is required to be the final mutation.
 */
export async function applyPlan(plan: OperationPlan): Promise<{ created: string[]; merged: string[] }> {
  if (plan.hasConflicts) {
    throw new Error('Cannot apply a plan that contains conflicts.');
  }
  const mutations = plan.operations.filter(({ action }) =>
    action === 'mkdir' || action === 'create' || action === 'merge',
  );
  const stateIndex = mutations.findIndex(({ path: targetPath }) => targetPath === '.drakom-ai/state.json');
  if (stateIndex !== -1 && stateIndex !== mutations.length - 1) {
    throw new Error('Invalid operation plan: state.json must be written last.');
  }

  for (const operation of mutations) {
    const absolutePath = resolveTarget(plan.root, operation.path);
    const currentType = await pathType(absolutePath);
    if (operation.action === 'mkdir') {
      if (currentType !== 'absent' && currentType !== 'directory') {
        throw new Error(`Preflight failed: ${operation.path} is not a directory.`);
      }
    } else if (operation.action === 'create') {
      if (currentType !== 'absent') {
        throw new Error(`Preflight failed: ${operation.path} now exists; rerun init.`);
      }
    } else {
      if (currentType !== 'file' || operation.before === undefined) {
        throw new Error(`Preflight failed: ${operation.path} cannot be merged safely.`);
      }
      const currentContent = await readFile(absolutePath, 'utf8');
      if (currentContent !== operation.before) {
        throw new Error(`Preflight failed: ${operation.path} changed after inspection; rerun init.`);
      }
    }
  }

  const createdFiles: string[] = [];
  const createdDirectories: string[] = [];
  const mergedFiles: Array<{ path: string; content: string }> = [];
  let temporaryCounter = 0;

  async function ensureDirectory(directory: string): Promise<void> {
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
      const absolutePath = resolveTarget(plan.root, operation.path);
      if (operation.action === 'mkdir') {
        if ((await pathType(absolutePath)) === 'absent') {
          await ensureDirectory(absolutePath);
        }
      } else if (operation.action === 'create') {
        await ensureDirectory(path.dirname(absolutePath));
        await writeFile(absolutePath, operation.content ?? '', { encoding: 'utf8', flag: 'wx' });
        createdFiles.push(absolutePath);
      } else {
        const previousContent = operation.before ?? '';
        const temporaryPath = path.join(
          path.dirname(absolutePath),
          `.${path.basename(absolutePath)}.drakom-ai-${process.pid}-${temporaryCounter}.tmp`,
        );
        temporaryCounter += 1;
        await writeFile(temporaryPath, operation.content ?? '', { encoding: 'utf8', flag: 'wx' });
        await rename(temporaryPath, absolutePath);
        mergedFiles.push({ path: absolutePath, content: previousContent });
      }
    }
  } catch (error) {
    for (const merged of mergedFiles.reverse()) {
      await writeFile(merged.path, merged.content, 'utf8');
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
    merged: mergedFiles.map(({ path: value }) => path.relative(plan.root, value)),
  };
}
