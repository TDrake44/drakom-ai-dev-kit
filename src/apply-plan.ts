import { isUtf8 } from 'node:buffer';
import { chmod, lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DRAKOM_DIR } from './constants.js';
import type { Operation, OperationPlan } from './operation-plan.js';

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function isMissing(error: unknown): boolean {
  return hasCode(error, 'ENOENT');
}

/** What a rewritten or deleted file held before, so a failed run can put it back. */
interface PreviousFile {
  path: string;
  content: string;
  mode: number;
}

/**
 * Refuse to rewrite or delete a file unless its bytes are exactly the text the plan was built from.
 * Text that is not valid UTF-8 never matches: it was decoded with replacement characters, and
 * writing that back would change bytes the plan does not mention.
 */
async function assertUnchanged(absolutePath: string, operation: Operation, command: string): Promise<void> {
  const bytes = await readFile(absolutePath);
  if (!isUtf8(bytes)) {
    throw new Error(
      `Preflight failed: ${operation.path} is not valid UTF-8, so it cannot be rewritten without changing its other bytes; convert it to UTF-8 and rerun ${command}.`,
    );
  }
  if (bytes.toString('utf8') !== operation.before) {
    throw new Error(`Preflight failed: ${operation.path} changed after inspection; rerun ${command}.`);
  }
}

async function restore(previous: PreviousFile): Promise<void> {
  await writeFile(previous.path, previous.content, 'utf8');
  await chmod(previous.path, previous.mode);
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
      const entry = await lstat(current);
      const realCurrent = await realpath(current).catch((error: unknown) => {
        if (entry.isSymbolicLink() && isMissing(error)) return null;
        throw error;
      });
      if (realCurrent !== null && realCurrent !== realRoot && !realCurrent.startsWith(`${realRoot}${path.sep}`)) {
        throw new Error(`Operation path escapes the target through a symlink: ${relativePath}`);
      }
      // Backstop for a planning mistake: planning never targets a path at or under a symlink.
      if (entry.isSymbolicLink()) {
        const linkPath = path.relative(root, current).split(path.sep).join('/');
        throw new Error(
          `Preflight failed: ${relativePath} is at or under a symlink; drakom-ai will not write through the symlink ${linkPath}.`,
        );
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
 * Apply a fully preflighted plan. State is required to be the final mutation. Conflicts are never
 * written; a plan that has them is applied only when planning marked it safe to apply around them.
 */
export async function applyPlan(plan: OperationPlan): Promise<ApplyResult> {
  if (plan.hasConflicts && plan.partialApply !== true) {
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
      await assertUnchanged(absolutePath, operation, plan.command);
    } else if (operation.action === 'delete') {
      if (currentType !== 'file' || operation.before === undefined) {
        throw new Error(`Preflight failed: ${operation.path} cannot be deleted safely.`);
      }
      await assertUnchanged(absolutePath, operation, plan.command);
    }
  }

  const createdFiles: string[] = [];
  const createdDirectories: string[] = [];
  const mergedFiles: PreviousFile[] = [];
  const updatedFiles: PreviousFile[] = [];
  const deletedFiles: PreviousFile[] = [];
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
        // The plan was checked before the first write; this file may have been saved since.
        await assertUnchanged(absolutePath, operation, plan.command);
        const previous = {
          path: absolutePath,
          content: operation.before ?? '',
          mode: (await lstat(absolutePath)).mode & 0o7777,
        };
        const temporaryPath = path.join(
          path.dirname(absolutePath),
          `.${path.basename(absolutePath)}.${DRAKOM_DIR.replace(/^\./, '')}-${process.pid}-${temporaryCounter}.tmp`,
        );
        temporaryCounter += 1;
        let wroteTemporary = false;
        try {
          await writeFile(temporaryPath, operation.content ?? '', { encoding: 'utf8', flag: 'wx' });
          wroteTemporary = true;
          await chmod(temporaryPath, previous.mode);
          await rename(temporaryPath, absolutePath);
        } catch (error) {
          // A temporary file that was already there is not ours to remove.
          if (wroteTemporary || !hasCode(error, 'EEXIST')) {
            await rm(temporaryPath, { force: true }).catch(() => undefined);
          }
          throw error;
        }
        (operation.action === 'update' ? updatedFiles : mergedFiles).push(previous);
      } else if (operation.action === 'delete') {
        await assertUnchanged(absolutePath, operation, plan.command);
        const previous = {
          path: absolutePath,
          content: operation.before ?? '',
          mode: (await lstat(absolutePath)).mode & 0o7777,
        };
        await unlink(absolutePath);
        deletedFiles.push(previous);
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
    // Every step is tried even when an earlier one fails, so one bad file cannot strand the rest.
    const unrestored: string[] = [];
    const undo = async (absolutePath: string, step: () => Promise<unknown>): Promise<void> => {
      try {
        await step();
      } catch {
        unrestored.push(path.relative(plan.root, absolutePath).split(path.sep).join('/'));
      }
    };
    for (const previous of [...updatedFiles.reverse(), ...mergedFiles.reverse()]) {
      await undo(previous.path, () => restore(previous));
    }
    for (const deleted of deletedFiles.reverse()) {
      await undo(deleted.path, async () => {
        await ensureDirectory(path.dirname(deleted.path));
        await restore(deleted);
      });
    }
    for (const createdFile of createdFiles.reverse()) {
      await undo(createdFile, () => rm(createdFile, { force: true }));
    }
    for (const createdDirectory of createdDirectories.reverse()) {
      await undo(createdDirectory, () =>
        rmdir(createdDirectory).catch((rollbackError: unknown) => {
          if (!isMissing(rollbackError) && !hasCode(rollbackError, 'ENOTEMPTY')) {
            throw rollbackError;
          }
        }),
      );
    }
    if (unrestored.length > 0) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}\nThe rollback could not undo the change to: ${unrestored.join(', ')}. Review it before running ${plan.command} again.`,
        { cause: error },
      );
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
