import { createHash } from 'node:crypto';

import type { TargetInventory } from './inspect-target.js';
import type { PackagePayload } from './package-payload.js';
import { serializeState, type InstallState } from './state.js';

export const MANAGED_BLOCK = `<!-- drakom-ai:start -->
## Drakom AI Development Context

Project-specific AI context is stored under \`.drakom-ai/\`.
Use \`$drakom-ai-setup\` to assess or revise the project's agent configuration.
<!-- drakom-ai:end -->`;

export type OperationAction = 'mkdir' | 'create' | 'merge' | 'preserve' | 'conflict' | 'warning';

export interface Operation {
  action: OperationAction;
  path: string;
  summary: string;
  content?: string;
  before?: string;
}

export interface OperationPlan {
  command: 'init';
  root: string;
  targetStatus: TargetInventory['status'];
  operations: Operation[];
  hasConflicts: boolean;
}

export function fingerprint(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/** Purely derive an initialization plan from an already-captured inventory. */
export function buildInitPlan(
  inventory: TargetInventory,
  options: { skipMcp: boolean },
  payload: PackagePayload,
): OperationPlan {
  const operations: Operation[] = [];
  const requirePayloadFile = (name: string): string => {
    const content = payload.files[name];
    if (content === undefined) {
      throw new Error(`Package payload is missing required file ${name}.`);
    }
    return content;
  };
  const setupTarget = '.agents/skills/drakom-ai-setup/SKILL.md';
  const setupSource = 'skills/drakom-ai-setup/SKILL.md';
  const setupContent = requirePayloadFile('setupSkill');
  const assessmentTarget = '.agents/skills/drakom-ai-setup/references/assessment-plan-template.md';
  const assessmentSource = 'skills/drakom-ai-setup/references/assessment-plan-template.md';
  const assessmentContent = requirePayloadFile('assessmentTemplate');
  const localIgnoreContent = requirePayloadFile('localIgnore');
  const mcpRegistryContent = requirePayloadFile('mcpRegistry');

  if (inventory.state !== null) {
    operations.push({
      action: 'preserve',
      path: '.drakom-ai/state.json',
      summary: 'Existing Drakom installation remains unchanged by this preview.',
    });
  } else if (inventory.hasDrakomDirectory) {
    operations.push({
      action: 'conflict',
      path: '.drakom-ai',
      summary: 'Directory exists without managed state; review ownership before initialization.',
    });
  }

  const inventoryHasPath = (targetPath: string): boolean =>
    inventory.paths.includes(targetPath) || inventory.paths.includes(`${targetPath}/`);

  const addDirectory = (targetPath: string, summary: string): void => {
    if (!inventoryHasPath(targetPath)) {
      operations.push({ action: 'mkdir', path: targetPath, summary });
    }
  };

  const addCreate = (targetPath: string, content: string, summary: string): void => {
    if (inventoryHasPath(targetPath)) {
      operations.push({ action: 'conflict', path: targetPath, summary: 'Unmanaged path already exists.' });
    } else {
      operations.push({ action: 'create', path: targetPath, summary, content });
    }
  };

  if (inventory.state === null) {
    addDirectory('.drakom-ai', 'Create the project context namespace.');
    addDirectory('.drakom-ai/rules', 'Create the tracked project rules directory.');
    addDirectory('.drakom-ai/plans', 'Create the ignored local plans directory.');
    addDirectory('.drakom-ai/specs', 'Create the tracked collaborative specifications directory.');
    addDirectory('.drakom-ai/assets', 'Create the ignored local assets directory.');
    addCreate(
      '.drakom-ai/.gitignore',
      localIgnoreContent,
      'Ignore local plans and assets while keeping tracked project context.',
    );
    if (!options.skipMcp) {
      addCreate('.drakom-ai/mcp-servers.yaml', mcpRegistryContent, 'Create the optional MCP source registry.');
    }
    addCreate(setupTarget, setupContent, 'Install the kit-managed project assessment skill.');
    addCreate(assessmentTarget, assessmentContent, 'Install the setup skill assessment plan template.');

    const agentsContent = inventory.contents['AGENTS.md'];
    if (agentsContent === undefined) {
      addCreate('AGENTS.md', `${MANAGED_BLOCK}\n`, 'Create the minimal project context router.');
    } else if (agentsContent.includes('<!-- drakom-ai:start -->') || agentsContent.includes('<!-- drakom-ai:end -->')) {
      operations.push({
        action: 'conflict',
        path: 'AGENTS.md',
        summary: 'Drakom markers exist but are not recorded as managed; review them before initialization.',
      });
    } else {
      operations.push({
        action: 'merge',
        path: 'AGENTS.md',
        summary: 'Append the managed Drakom routing block while preserving existing content.',
        content: `${agentsContent.trimEnd()}\n\n${MANAGED_BLOCK}\n`,
        before: agentsContent,
      });
    }

    const claudeContent = inventory.contents['CLAUDE.md'];
    if (claudeContent === undefined) {
      addCreate('CLAUDE.md', '@AGENTS.md\n', 'Create a Claude import for the shared project context.');
    } else if (/^@AGENTS\.md\s*$/mu.test(claudeContent)) {
      operations.push({ action: 'preserve', path: 'CLAUDE.md', summary: 'Existing AGENTS.md import is already present.' });
    } else {
      operations.push({
        action: 'merge',
        path: 'CLAUDE.md',
        summary: 'Append an AGENTS.md import while preserving custom Claude instructions.',
        content: `${claudeContent.trimEnd()}\n\n@AGENTS.md\n`,
        before: claudeContent,
      });
    }

    const state: InstallState = {
      schemaVersion: 1,
      kitVersion: payload.manifest.kitVersion,
      features: { mcp: !options.skipMcp, skillMirrors: true },
      managedFiles: {
        [setupTarget]: { source: setupSource, fingerprint: fingerprint(setupContent) },
        [assessmentTarget]: { source: assessmentSource, fingerprint: fingerprint(assessmentContent) },
      },
      managedBlocks: {
        'AGENTS.md#drakom-ai': { fingerprint: fingerprint(`${MANAGED_BLOCK}\n`) },
      },
      managedMcpServers: {},
    };
    addCreate('.drakom-ai/state.json', serializeState(state), 'Record managed ownership after all other operations succeed.');
  }

  operations.push({
    action: 'preserve',
    path: '*',
    summary: 'Preserve all existing files not explicitly listed for a structured merge.',
  });

  return {
    command: 'init',
    root: inventory.root,
    targetStatus: inventory.status,
    operations,
    hasConflicts: operations.some(({ action }) => action === 'conflict'),
  };
}
