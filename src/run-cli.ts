import { parseCliArgs } from './cli-arguments.js';
import { applyPlan } from './apply-plan.js';
import { DRAKOM_DIR } from './constants.js';
import { inspectTarget } from './inspect-target.js';
import { buildInitPlan, buildSyncPlan, compareVersions } from './operation-plan.js';
import { loadPackagePayload } from './package-payload.js';
import { renderPlan } from './render-plan.js';

interface TextWriter {
  write(content: string): boolean;
}

export interface CliIo {
  stdout: TextWriter;
  stderr: TextWriter;
  confirm?: () => Promise<boolean>;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  try {
    const args = parseCliArgs(argv);
    if (args.command === 'init') {
      const inventory = await inspectTarget(args.targetPath);
      const payload = await loadPackagePayload();
      const plan = buildInitPlan(inventory, { skipMcp: args.skipMcp }, payload);
      io.stdout.write(renderPlan(plan));
      if (args.dryRun || plan.hasConflicts) {
        return plan.hasConflicts ? 2 : 0;
      }

      const mutations = plan.operations.filter(({ action }) =>
        action === 'mkdir' || action === 'create' || action === 'merge',
      );
      if (mutations.length === 0) {
        io.stdout.write('Installation is already initialized; no changes made.\n');
        return 0;
      }
      if (args.yes && mutations.some(({ action }) => action === 'merge')) {
        io.stderr.write('--yes authorizes create-only initialization; rerun interactively to approve structured merges.\n');
        return 2;
      }
      if (!args.yes) {
        if (io.confirm === undefined || !(await io.confirm())) {
          io.stdout.write('Initialization cancelled; no changes made.\n');
          return 0;
        }
      }

      const result = await applyPlan(plan);
      io.stdout.write(`Applied ${result.created.length} creates and ${result.merged.length} structured merges.\n`);
      io.stdout.write('Ask your coding agent to use $drakom-ai-setup to assess this repository.\n');
      return 0;
    }

    // args.command === 'sync'
    const inventory = await inspectTarget(args.targetPath);
    if (inventory.state === null) {
      if (inventory.hasDrakomDirectory) {
        throw new Error(`Directory ${DRAKOM_DIR} exists without managed state; review ownership before synchronizing.`);
      }
      throw new Error('Target is not an initialized Drakom installation; run init first.');
    }
    const payload = await loadPackagePayload();
    if (compareVersions(inventory.state.kitVersion, payload.manifest.kitVersion) > 0) {
      throw new Error(
        `Target was initialized with kitVersion ${inventory.state.kitVersion}, which is newer than CLI kitVersion ${payload.manifest.kitVersion}; upgrade drakom-ai.`,
      );
    }
    const plan = buildSyncPlan(inventory, payload);
    io.stdout.write(renderPlan(plan));

    const hasDrift = plan.operations.some(
      ({ action }) => action === 'create' || action === 'update' || action === 'delete' || action === 'conflict',
    );

    if (args.check && hasDrift) {
      io.stderr.write('Drift detected: managed files or skill mirrors require synchronization.\n');
      return 2;
    }

    if (args.dryRun || args.check) {
      return plan.hasConflicts ? 2 : 0;
    }

    if (plan.hasConflicts) {
      return 2;
    }

    const mutations = plan.operations.filter(
      ({ action }) =>
        action === 'mkdir' || action === 'create' || action === 'update' || action === 'delete' || action === 'merge',
    );
    if (mutations.length === 0) {
      io.stdout.write('Installation is already up to date; no changes made.\n');
      return 0;
    }

    const result = await applyPlan(plan);
    io.stdout.write(
      `Synchronized: ${result.updated.length} updated, ${result.created.length} created, ${result.deleted.length} deleted.\n`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`drakom-ai: ${message}\n`);
    return 1;
  }
}
