import { parseCliArgs } from './cli-arguments.js';
import { renderCliHelp } from './cli-help.js';
import { applyPlan } from './apply-plan.js';
import { DRAKOM_DIR } from './constants.js';
import { inspectTarget } from './inspect-target.js';
import { discoverMcp, renderMcpComparisonReport } from './mcp-discovery.js';
import { resolveManagedFileOptions } from './managed-file-options.js';
import {
  buildInitPlan,
  buildSyncPlan,
  compareVersions,
  createOnceSources,
  listKitManagedFiles,
} from './operation-plan.js';
import { loadPackageMetadata } from './package-metadata.js';
import { loadPackagePayload } from './package-payload.js';
import { renderPlan } from './render-plan.js';

interface TextWriter {
  write(content: string): boolean;
}

/** A confirmation result: approved, declined, or `no-answer` when input ended before any answer. */
export type ConfirmAnswer = boolean | 'no-answer';

export interface CliIo {
  stdout: TextWriter;
  stderr: TextWriter;
  confirm?: () => Promise<ConfirmAnswer>;
}

function assertTargetNotNewerThanCli(targetKitVersion: string, cliKitVersion: string): void {
  if (compareVersions(targetKitVersion, cliKitVersion) > 0) {
    throw new Error(
      `Target was initialized with kitVersion ${targetKitVersion}, which is newer than CLI kitVersion ${cliKitVersion}; upgrade drakom-ai.`,
    );
  }
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  try {
    const args = parseCliArgs(argv);
    if (args.command === 'help') {
      io.stdout.write(renderCliHelp(args.topic));
      return 0;
    }

    if (args.command === 'version') {
      io.stdout.write(`${(await loadPackageMetadata()).version}\n`);
      return 0;
    }

    if (args.command === 'init') {
      const inventory = await inspectTarget(args.targetPath);
      const payload = await loadPackagePayload();
      const plan = buildInitPlan(inventory, { skipMcp: args.skipMcp }, payload);
      io.stdout.write(renderPlan(plan));
      if (!args.skipMcp) {
        const discovered = discoverMcp(inventory);
        if (
          discovered.clientFiles.length > 0 ||
          discovered.servers.size > 0 ||
          (discovered.fileErrors && Object.keys(discovered.fileErrors).length > 0)
        ) {
          io.stdout.write(`\n${renderMcpComparisonReport(discovered)}\n`);
        }
      }
      if (args.dryRun || plan.hasConflicts) {
        if (!plan.hasConflicts) {
          io.stdout.write('Dry run; no changes made.\n');
        }
        return plan.hasConflicts ? 2 : 0;
      }

      const mutations = plan.operations.filter(({ action }) =>
        action === 'mkdir' || action === 'create' || action === 'update' || action === 'merge',
      );
      if (mutations.length === 0) {
        io.stdout.write('Installation is already initialized; no changes made.\n');
        return 0;
      }
      if (args.yes && mutations.some(({ action }) => action === 'merge')) {
        io.stderr.write('--yes cannot approve structured merges; rerun interactively to review them.\n');
        return 2;
      }
      if (!args.yes) {
        const answer = io.confirm === undefined ? false : await io.confirm();
        if (answer === 'no-answer') {
          io.stderr.write(
            'No answer to the prompt because input ended; no changes made. Use --yes to apply without a prompt, or --dry-run to preview.\n',
          );
          return 2;
        }
        if (!answer) {
          io.stdout.write('Initialization cancelled; no changes made.\n');
          return 0;
        }
      }

      const result = await applyPlan(plan);
      io.stdout.write(
        `Applied ${result.created.length} creates, ${result.updated.length} updates, and ${result.merged.length} structured merges.\n`,
      );
      io.stdout.write('Ask your coding agent to use $drakom-ai-setup to assess this repository.\n');
      return 0;
    }

    // args.command === 'sync'
    const payload = await loadPackagePayload();
    const inventory = await inspectTarget(args.targetPath, {
      unreadManagedFiles: createOnceSources(payload),
      alsoRead: listKitManagedFiles(payload).keys(),
    });
    if (inventory.state === null) {
      if (inventory.hasDrakomDirectory) {
        throw new Error(`Directory ${DRAKOM_DIR} exists without managed state; review ownership before synchronizing.`);
      }
      throw new Error('Target is not an initialized Drakom installation; run init first.');
    }
    assertTargetNotNewerThanCli(inventory.state.kitVersion, payload.manifest.kitVersion);
    const resolutions = resolveManagedFileOptions(inventory, payload, args);
    const plan = buildSyncPlan(inventory, payload, resolutions);
    io.stdout.write(renderPlan(plan));

    const hasDrift = plan.operations.some(
      ({ action }) => action === 'create' || action === 'update' || action === 'delete' || action === 'conflict',
    );

    if (args.check && hasDrift) {
      io.stderr.write('Drift detected: managed files or skill mirrors require synchronization.\n');
      return 2;
    }

    const blocked = plan.hasConflicts && plan.partialApply !== true;
    if (args.dryRun || args.check) {
      // A blocked plan's result line already says that nothing was changed.
      if (!blocked) {
        io.stdout.write(args.check ? 'No drift detected; no changes made.\n' : 'Dry run; no changes made.\n');
      }
      return plan.hasConflicts ? 2 : 0;
    }

    if (blocked) {
      return 2;
    }

    const conflictPaths = [
      ...new Set(plan.operations.filter(({ action }) => action === 'conflict').map(({ path }) => path)),
    ];
    const remaining =
      conflictPaths.length === 0
        ? ''
        : ` ${conflictPaths.length === 1 ? 'Conflict remains' : 'Conflicts remain'}, left unchanged: ${conflictPaths.join(', ')}.`;
    const mutations = plan.operations.filter(
      ({ action }) =>
        action === 'mkdir' || action === 'create' || action === 'update' || action === 'delete' || action === 'merge',
    );
    if (mutations.length === 0) {
      if (plan.hasConflicts) {
        io.stdout.write(`Nothing else to synchronize; no changes made.${remaining}\n`);
        return 2;
      }
      io.stdout.write('Installation is already up to date; no changes made.\n');
      return 0;
    }

    const result = await applyPlan(plan);
    io.stdout.write(
      `Synchronized: ${result.updated.length} updated, ${result.created.length} created, ${result.deleted.length} deleted.${remaining}\n`,
    );
    return plan.hasConflicts ? 2 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`drakom-ai: ${message}\n`);
    return 1;
  }
}
