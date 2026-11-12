import { load as loadYaml } from 'js-yaml';

import type { SymlinkEntry, TargetInventory } from './inspect-target.js';
import { checkLiteralCredentials } from './mcp-discovery.js';
import { generateMcpOperations, validateMcpRegistry } from './mcp-generation.js';
import type { PackagePayload } from './package-payload.js';
import {
  compareVersions,
  DRAKOM_DIR,
  serializeState,
  type InstallState,
  type ManagedFileState,
  type ManagedMcpServerState,
} from './state.js';
import { fingerprint } from './util.js';

export { compareVersions, DRAKOM_DIR };

export const MANAGED_BLOCK = `<!-- drakom-ai:start -->
## Drakom AI Development Context

Project-specific AI context is stored under \`${DRAKOM_DIR}/\`.
Use \`$drakom-ai-setup\` to assess or revise the project's agent configuration.
Use \`$drakom-skill-author\` to find, write, check, refine, or retire project-owned skills.
Use \`$drakom-plan-audit\` to audit or clean up local plans in \`${DRAKOM_DIR}/plans/\`.
<!-- drakom-ai:end -->`;

export const NOTICE =
  '<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "drakom-ai sync ." through your package runner to update. -->';

export const WORKTREEINCLUDE_ENTRIES = [
  `${DRAKOM_DIR}/plans/*`,
  `${DRAKOM_DIR}/assets/*`,
];

/** Payload files that every init installs and manages, as payload key to target path. */
const INIT_MANAGED_TARGETS = {
  setupSkill: '.agents/skills/drakom-ai-setup/SKILL.md',
  assessmentTemplate: '.agents/skills/drakom-ai-setup/references/assessment-plan-template.md',
} as const;

export const DEFAULT_WORKTREEINCLUDE = `${WORKTREEINCLUDE_ENTRIES.join('\n')}\n`;

export type OperationAction =
  | 'mkdir'
  | 'create'
  | 'update'
  | 'delete'
  | 'merge'
  | 'preserve'
  | 'conflict'
  | 'warning';

export interface Operation {
  action: OperationAction;
  path: string;
  summary: string;
  content?: string;
  before?: string;
}

export interface OperationPlan {
  command: 'init' | 'sync';
  root: string;
  targetStatus: TargetInventory['status'];
  /** Existing agent context paths found during init inspection, in inventory order; never their contents. */
  detectedContext?: string[];
  operations: Operation[];
  hasConflicts: boolean;
  /**
   * True for a sync plan whose conflicts hold back only their own items, so the remaining
   * operations can be applied. Absent or false means any conflict blocks the whole plan.
   */
  partialApply?: boolean;
}

/** Managed files the user resolved on this run, as validated root-relative POSIX paths. */
export interface ManagedFileResolutions {
  /** Keep the local edit; set by `sync --accept`. */
  accept: ReadonlySet<string>;
  /** Stop managing the file; set by `sync --release`. */
  release: ReadonlySet<string>;
}

export function isGeneratedMirrorContent(content: string): boolean {
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
  const body = frontmatter ? content.slice(frontmatter.length).replace(/^(?:\r?\n)*/, '') : content;
  return body === NOTICE || body.startsWith(`${NOTICE}\n`) || body.startsWith(`${NOTICE}\r\n`);
}

export function createMirrorContent(content: string, noticeMarker: string = NOTICE): string {
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
  if (!frontmatter) return `${noticeMarker}\n\n${content}`;

  return `${frontmatter}\n${noticeMarker}\n\n${content.slice(frontmatter.length)}`;
}

export function extractManagedBlock(content: string, identifier: string): string | null {
  const startMarker = `<!-- ${identifier}:start -->`;
  const endMarker = `<!-- ${identifier}:end -->`;
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return null;
  }
  let block = content.slice(startIndex, endIndex + endMarker.length);
  const afterEnd = content.slice(endIndex + endMarker.length);
  if (afterEnd.startsWith('\r\n')) {
    block += '\r\n';
  } else if (afterEnd.startsWith('\n')) {
    block += '\n';
  }
  return block;
}

/** Say where a symlink leads, for conflict messages. */
function describeSymlink(entry: SymlinkEntry): string {
  if (entry.status === 'outside') return `Symlink to ${entry.target}, which is outside the repository`;
  if (entry.status === 'broken') return `Symlink to ${entry.target}, which does not exist`;
  return entry.resolved === entry.target
    ? `Symlink to ${entry.target}`
    : `Symlink to ${entry.target} (${entry.resolved})`;
}

/** Conflicts that already explain a symlink; the write guard leaves them as they are. */
const symlinkConflicts = new WeakSet<Operation>();

function symlinkConflict(linkPath: string, summary: string): Operation {
  const operation: Operation = { action: 'conflict', path: linkPath, summary };
  symlinkConflicts.add(operation);
  return operation;
}

/** The outermost symlink at `targetPath` or among its ancestors, if any. */
function findSymlinkOnPath(inventory: TargetInventory, targetPath: string): string | undefined {
  const segments = targetPath.replace(/\/+$/, '').split('/');
  for (let index = 1; index <= segments.length; index += 1) {
    const candidate = segments.slice(0, index).join('/');
    if (Object.hasOwn(inventory.symlinks, candidate)) return candidate;
  }
  return undefined;
}

/**
 * Never write through a symlink the planner did not recognise. Every operation other than a
 * preserve or a warning whose path is, or sits under, a symlink becomes one conflict per link.
 */
function refuseUnrecognisedSymlinks(inventory: TargetInventory, operations: Operation[]): Operation[] {
  const reported = new Set(operations.filter((op) => symlinkConflicts.has(op)).map((op) => op.path));
  const guarded: Operation[] = [];
  for (const operation of operations) {
    if (symlinkConflicts.has(operation) || operation.action === 'preserve' || operation.action === 'warning') {
      guarded.push(operation);
      continue;
    }
    const linkPath = findSymlinkOnPath(inventory, operation.path);
    const entry = linkPath === undefined ? undefined : inventory.symlinks[linkPath];
    if (linkPath === undefined || entry === undefined) {
      guarded.push(operation);
      continue;
    }
    if (reported.has(linkPath)) continue;
    reported.add(linkPath);
    guarded.push(
      symlinkConflict(
        linkPath,
        `${describeSymlink(entry)}; drakom-ai will not write through it. To fix, replace the link with a real file or directory, then rerun.`,
      ),
    );
  }
  return guarded;
}

/**
 * Whether a symlink resolves to `canonicalPath`. A broken link counts only when it names that path
 * exactly and the plan creates what it points to.
 */
function linksTo(entry: SymlinkEntry, canonicalPath: string, createdByPlan: boolean): boolean {
  if (entry.resolved !== canonicalPath) return false;
  return entry.status === 'inside' || (entry.status === 'broken' && createdByPlan);
}

type MirrorLink =
  | { kind: 'none' }
  | { kind: 'canonical'; linkPath: string; canonicalPath: string }
  | { kind: 'other'; linkPath: string; summary: string };

/**
 * Classify the symlinks on the way to a skill's Claude mirror. A link at `.claude/skills` or at
 * `.claude/skills/<name>` to the matching canonical directory delivers the skill already; any other
 * link must never be written through.
 */
function findMirrorLink(inventory: TargetInventory, skillName: string, canonicalCreatedByPlan: boolean): MirrorLink {
  const skillDir = `.claude/skills/${skillName}`;
  const canonicalDir = `.agents/skills/${skillName}`;
  const candidates: Array<{ linkPath: string; canonicalPath: string | null; remedy: string }> = [
    {
      linkPath: '.claude/skills',
      canonicalPath: '.agents/skills',
      remedy: 'point it at .agents/skills, or replace it with a real directory so drakom-ai can write the mirrors',
    },
    {
      linkPath: skillDir,
      canonicalPath: canonicalDir,
      remedy: `point it at ${canonicalDir}, or remove it so drakom-ai can write the mirror`,
    },
    {
      linkPath: `${skillDir}/SKILL.md`,
      canonicalPath: null,
      remedy: `link the folder ${skillDir} to ${canonicalDir} instead, or remove the link so drakom-ai can write the mirror`,
    },
  ];
  for (const { linkPath, canonicalPath, remedy } of candidates) {
    const entry = inventory.symlinks[linkPath];
    if (entry === undefined) continue;
    if (canonicalPath !== null && linksTo(entry, canonicalPath, canonicalCreatedByPlan)) {
      return { kind: 'canonical', linkPath, canonicalPath };
    }
    const expected = canonicalPath === null ? 'a regular file' : `the canonical ${canonicalPath}`;
    return {
      kind: 'other',
      linkPath,
      summary: `${describeSymlink(entry)}, not ${expected}; drakom-ai will not write through it. To fix, ${remedy}.`,
    };
  }
  return { kind: 'none' };
}

function planWorktreeInclude(
  inventory: TargetInventory,
  operations: Operation[],
  addCreate: (targetPath: string, content: string, summary: string) => void,
): void {
  const worktreePath = '.worktreeinclude';
  const worktreeContent = inventory.contents[worktreePath];
  if (inventory.pathSet.has(`${worktreePath}/`)) {
    operations.push({
      action: 'conflict',
      path: worktreePath,
      summary: 'Directory exists at .worktreeinclude; review ownership before initialization.',
    });
  } else if (worktreeContent === undefined) {
    addCreate(
      worktreePath,
      DEFAULT_WORKTREEINCLUDE,
      'Create the worktree include manifest to preserve local context.',
    );
  } else {
    const existingLines = worktreeContent
      .split(/\r?\n/)
      .map((line) => line.trim());
    const missingLines = WORKTREEINCLUDE_ENTRIES.filter(
      (required) =>
        !existingLines.includes(required) &&
        !existingLines.includes(required.replace(/\/\*$/, '')),
    );
    if (missingLines.length === 0) {
      operations.push({
        action: 'preserve',
        path: worktreePath,
        summary: 'Existing .worktreeinclude already contains Drakom directories.',
      });
    } else {
      const trimmed = worktreeContent.trimEnd();
      const content = trimmed.length === 0 ? `${missingLines.join('\n')}\n` : `${trimmed}\n${missingLines.join('\n')}\n`;
      operations.push({
        action: 'merge',
        path: worktreePath,
        summary: 'Append local Drakom directories to existing .worktreeinclude manifest.',
        content,
        before: worktreeContent,
      });
    }
  }
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
  const setupTarget = INIT_MANAGED_TARGETS.setupSkill;
  const setupSource = 'skills/drakom-ai-setup/SKILL.md';
  const setupContent = requirePayloadFile('setupSkill');
  const assessmentTarget = INIT_MANAGED_TARGETS.assessmentTemplate;
  const assessmentSource = 'skills/drakom-ai-setup/references/assessment-plan-template.md';
  const assessmentContent = requirePayloadFile('assessmentTemplate');
  const localIgnoreContent = requirePayloadFile('localIgnore');
  const mcpRegistryContent = requirePayloadFile('mcpRegistry');
  const stateTarget = `${DRAKOM_DIR}/state.json`;

  const inventoryHasPath = (targetPath: string): boolean =>
    inventory.pathSet.has(targetPath) || inventory.pathSet.has(`${targetPath}/`);

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

  if (inventory.state !== null) {
    planWorktreeInclude(inventory, operations, addCreate);
    operations.push({
      action: 'preserve',
      path: stateTarget,
      summary: 'Existing Drakom installation remains unchanged; run "drakom-ai sync" to apply kit updates.',
    });
  } else if (inventory.hasDrakomDirectory) {
    operations.push({
      action: 'conflict',
      path: DRAKOM_DIR,
      summary: 'Directory exists without managed state; review ownership before initialization.',
    });
  }

  if (inventory.state === null) {
    addDirectory(DRAKOM_DIR, 'Create the project context namespace.');
    addDirectory(`${DRAKOM_DIR}/rules`, 'Create the tracked project rules directory.');
    addDirectory(`${DRAKOM_DIR}/plans`, 'Create the ignored local plans directory.');
    addDirectory(`${DRAKOM_DIR}/specs`, 'Create the tracked collaborative specifications directory.');
    addDirectory(`${DRAKOM_DIR}/assets`, 'Create the ignored local assets directory.');
    addCreate(
      `${DRAKOM_DIR}/.gitignore`,
      localIgnoreContent,
      'Ignore local plans and assets while keeping tracked project context.',
    );
    if (!options.skipMcp) {
      addCreate(`${DRAKOM_DIR}/mcp-servers.yaml`, mcpRegistryContent, 'Create the optional MCP source registry.');
    }
    for (const entry of listCreateOnceFiles(payload)) {
      if (inventory.pathSet.has(entry.target)) {
        operations.push({
          action: 'preserve',
          path: entry.target,
          summary: 'Existing starter file is project-owned; left as it is.',
        });
      } else {
        addCreate(entry.target, entry.content, 'Create a starter file; it is project-owned from then on.');
      }
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
    const claudeLink = inventory.symlinks['CLAUDE.md'];
    if (claudeLink !== undefined) {
      const agentsCreated = operations.some(({ action, path }) => action === 'create' && path === 'AGENTS.md');
      if (linksTo(claudeLink, 'AGENTS.md', agentsCreated)) {
        operations.push({
          action: 'preserve',
          path: 'CLAUDE.md',
          summary: 'Symlink to AGENTS.md already gives Claude the shared project context.',
        });
      } else {
        operations.push(
          symlinkConflict(
            'CLAUDE.md',
            `${describeSymlink(claudeLink)}, not AGENTS.md; drakom-ai will not write through it. To fix, point it at AGENTS.md, or replace it with a regular file so drakom-ai can add the AGENTS.md import.`,
          ),
        );
      }
    } else if (claudeContent === undefined) {
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

    planWorktreeInclude(inventory, operations, addCreate);

    const managedFiles: Record<string, ManagedFileState> = {
      [setupTarget]: { source: setupSource, fingerprint: fingerprint(setupContent) },
      [assessmentTarget]: { source: assessmentSource, fingerprint: fingerprint(assessmentContent) },
    };
    for (const entry of listPayloadDefaults(payload)) {
      if (!Object.hasOwn(managedFiles, entry.target)) {
        addCreate(entry.target, entry.content, 'Install a kit-managed default file.');
        managedFiles[entry.target] = { source: entry.source, fingerprint: fingerprint(entry.content) };
      }
    }

    const state: InstallState = {
      schemaVersion: 1,
      kitVersion: payload.manifest.kitVersion,
      features: { mcp: !options.skipMcp, skillMirrors: true },
      managedFiles,
      managedBlocks: {
        'AGENTS.md#drakom-ai': { fingerprint: fingerprint(`${MANAGED_BLOCK}\n`) },
      },
      managedSkillMirrors: {},
      managedMcpServers: {},
    };
    const mirrorStart = operations.length;
    const kitSkillPaths = new Set(Object.keys(managedFiles).filter((target) => target.endsWith('/SKILL.md')));
    const mirrorPlan = planSkillMirrors(inventory, state, operations, kitSkillPaths);
    state.managedSkillMirrors = recordSkillMirrors(inventory, operations.slice(mirrorStart), mirrorPlan, {});
    addCreate(stateTarget, serializeState(state), 'Record managed ownership after all other operations succeed.');
  }

  operations.push({
    action: 'preserve',
    path: '*',
    summary: 'Preserve all existing files not explicitly listed for a structured merge.',
  });
  const guardedOperations = refuseUnrecognisedSymlinks(inventory, operations);

  return {
    command: 'init',
    root: inventory.root,
    targetStatus: inventory.status,
    detectedContext: [...inventory.contextFiles],
    operations: guardedOperations,
    hasConflicts: guardedOperations.some(({ action }) => action === 'conflict'),
  };
}

interface ResolvedPayloadDefault {
  target: string;
  source: string;
  content: string;
  addedIn: string;
}

function listPayloadDefaults(payload: PackagePayload): ResolvedPayloadDefault[] {
  return Object.entries(payload.manifest.defaults).map(([name, entry]) => {
    const source = payload.manifest.files[name];
    const content = payload.files[name];
    if (source === undefined || content === undefined) {
      throw new Error(`Package payload is missing default file ${name}.`);
    }
    return { target: entry.target, source, content, addedIn: entry.addedIn };
  });
}

interface ResolvedCreateOnceFile {
  target: string;
  source: string;
  content: string;
}

function listCreateOnceFiles(payload: PackagePayload): ResolvedCreateOnceFile[] {
  return Object.entries(payload.manifest.createOnce).map(([name, entry]) => {
    const source = payload.manifest.files[name];
    const content = payload.files[name];
    if (source === undefined || content === undefined) {
      throw new Error(`Package payload is missing create-once file ${name}.`);
    }
    return { target: entry.target, source, content };
  });
}

/** The payload's create-once files as target path to payload source; sync never reads or writes them. */
export function createOnceSources(payload: PackagePayload): Map<string, string> {
  return new Map(listCreateOnceFiles(payload).map(({ target, source }) => [target, source]));
}

/**
 * Install defaults introduced after the project's recorded kit version. A default the project
 * removed after reaching its `addedIn` version is never offered again.
 */
function planNewDefaults(
  inventory: TargetInventory,
  state: InstallState,
  payload: PackagePayload,
  operations: Operation[],
): Record<string, ManagedFileState> {
  const addedManagedFiles: Record<string, ManagedFileState> = {};
  for (const entry of listPayloadDefaults(payload)) {
    if (
      Object.hasOwn(state.managedFiles, entry.target) ||
      state.releasedFiles?.includes(entry.target) === true ||
      compareVersions(entry.addedIn, state.kitVersion) <= 0
    ) {
      continue;
    }
    if (inventory.pathSet.has(entry.target) || inventory.pathSet.has(`${entry.target}/`)) {
      operations.push({
        action: 'conflict',
        path: entry.target,
        summary: `Unmanaged path occupies a default file added in kit version ${entry.addedIn}. Move or remove it, then run \`drakom-ai sync\` again to install the default.`,
      });
      continue;
    }
    operations.push({
      action: 'create',
      path: entry.target,
      summary: `Install default file added in kit version ${entry.addedIn}.`,
      content: entry.content,
    });
    addedManagedFiles[entry.target] = { source: entry.source, fingerprint: fingerprint(entry.content) };
  }
  return addedManagedFiles;
}

/** Payload file contents keyed by their payload-relative source path. */
export function payloadContentBySource(payload: PackagePayload): Map<string, string> {
  const contentBySource = new Map<string, string>();
  for (const [key, sourceRel] of Object.entries(payload.manifest.files)) {
    const fileContent = payload.files[key];
    if (fileContent !== undefined) {
      contentBySource.set(sourceRel, fileContent);
    }
  }
  return contentBySource;
}

/**
 * Every file the kit installs and keeps managed, keyed by target path. The create-once starter
 * files are project-owned and are not included.
 */
export function listKitManagedFiles(payload: PackagePayload): Map<string, { source: string; content: string }> {
  const kitFiles = new Map<string, { source: string; content: string }>();
  for (const [name, target] of Object.entries(INIT_MANAGED_TARGETS)) {
    const source = payload.manifest.files[name];
    const content = payload.files[name];
    if (source !== undefined && content !== undefined) {
      kitFiles.set(target, { source, content });
    }
  }
  for (const entry of listPayloadDefaults(payload)) {
    if (!kitFiles.has(entry.target)) {
      kitFiles.set(entry.target, { source: entry.source, content: entry.content });
    }
  }
  return kitFiles;
}

function resolutionHint(managedPath: string, options: { accept: boolean }): string {
  const release = `\`drakom-ai sync --release ${managedPath}\` to stop managing it`;
  return options.accept
    ? `run \`drakom-ai sync --accept ${managedPath}\` to keep your edit, or ${release}`
    : `run ${release}`;
}

interface ManagedFilePlan {
  /** Records dropped from state; the files are left as they are. */
  released: Set<string>;
  /** The released records that `--release` asked for; state remembers them so they stay released. */
  releasedOnRequest: Set<string>;
  /** Records to rewrite without a file write: accepted edits and files that already match the kit. */
  recorded: Record<string, ManagedFileState>;
  /** Managed files left in conflict; their records and files are not touched. */
  conflicted: Set<string>;
}

/**
 * Check each recorded managed file against the payload. A conflict holds back only its own file.
 * Records are released on request, and for the create-once files that kits up to 0.5.0 recorded as
 * managed: a record whose path and source both match one is dropped without reading the file.
 */
function planManagedFiles(
  inventory: TargetInventory,
  state: InstallState,
  payload: PackagePayload,
  operations: Operation[],
  resolutions: ManagedFileResolutions,
): ManagedFilePlan {
  const releasable = createOnceSources(payload);
  const released = new Set<string>();
  const releasedOnRequest = new Set<string>();
  const recorded: Record<string, ManagedFileState> = {};
  const conflicted = new Set<string>();
  const payloadSourceToContent = payloadContentBySource(payload);
  const kitVersion = payload.manifest.kitVersion;
  const conflict = (managedPath: string, summary: string): void => {
    conflicted.add(managedPath);
    operations.push({ action: 'conflict', path: managedPath, summary });
  };

  for (const [managedPath, entry] of Object.entries(state.managedFiles)) {
    const currentContent = inventory.contents[managedPath];
    if (resolutions.release.has(managedPath)) {
      released.add(managedPath);
      releasedOnRequest.add(managedPath);
      operations.push({
        action: 'preserve',
        path: managedPath,
        summary:
          currentContent !== undefined
            ? 'Released from kit management; the file is left as it is and is now project-owned.'
            : inventory.pathSet.has(managedPath) || inventory.pathSet.has(`${managedPath}/`)
              ? 'Released from kit management; what is at this path is left as it is and is now project-owned.'
              : 'Released from kit management; the file stays absent and the kit will not recreate it.',
      });
      continue;
    }

    if (releasable.get(managedPath) === entry.source) {
      released.add(managedPath);
      operations.push({
        action: 'preserve',
        path: managedPath,
        summary: 'Starter file is now project-owned; release it from kit management and leave the file as it is.',
      });
      continue;
    }

    if (currentContent === undefined) {
      conflict(
        managedPath,
        `Managed file is missing. Restore it, or ${resolutionHint(managedPath, { accept: false })}.`,
      );
      continue;
    }

    const currentFp = fingerprint(currentContent);
    const payloadContent = payloadSourceToContent.get(entry.source);
    const payloadFp = payloadContent === undefined ? undefined : fingerprint(payloadContent);

    if (payloadFp !== undefined && resolutions.accept.has(managedPath) && currentFp !== payloadFp) {
      // The kit's version is the baseline, so a CLI that ignores the accepted edit sees a modified file.
      if (entry.fingerprint !== payloadFp || entry.acceptedFingerprint !== currentFp) {
        recorded[managedPath] = { source: entry.source, fingerprint: payloadFp, acceptedFingerprint: currentFp };
      }
      operations.push({
        action: 'preserve',
        path: managedPath,
        summary: `Local edit accepted; it is kept until a kit version after ${kitVersion} changes this file.`,
      });
      continue;
    }

    if (currentFp === payloadFp) {
      if (entry.fingerprint !== currentFp || entry.acceptedFingerprint !== undefined) {
        recorded[managedPath] = { source: entry.source, fingerprint: currentFp };
      }
      operations.push({
        action: 'preserve',
        path: managedPath,
        summary:
          entry.fingerprint === currentFp
            ? 'Kit-managed file is up to date.'
            : `Kit-managed file already matches kit version ${kitVersion}; record it as up to date.`,
      });
      continue;
    }

    const recordedContentFp = entry.acceptedFingerprint ?? entry.fingerprint;
    if (currentFp !== recordedContentFp) {
      const what =
        entry.acceptedFingerprint === undefined
          ? 'Managed file was locally modified.'
          : 'Managed file was edited again after its local edit was accepted.';
      conflict(
        managedPath,
        `${what} Restore the kit version, or ${resolutionHint(managedPath, { accept: payloadFp !== undefined })}.`,
      );
      continue;
    }

    if (payloadContent === undefined) {
      conflict(
        managedPath,
        `Managed file source ${entry.source} is missing from this kit version, so the kit no longer ships it. Review the upgrade notes, then delete the file or keep it, and ${resolutionHint(managedPath, { accept: false })}.`,
      );
      continue;
    }

    if (entry.acceptedFingerprint !== undefined) {
      if (entry.fingerprint === payloadFp) {
        operations.push({
          action: 'preserve',
          path: managedPath,
          summary: 'Accepted local edit is kept; the kit has not changed this file since it was accepted.',
        });
      } else {
        conflict(
          managedPath,
          `Kit version ${kitVersion} changed this file, which has an accepted local edit. Compare it with the kit's copy (payload/v1/${entry.source} in the installed package) and merge what you want, then ${resolutionHint(managedPath, { accept: true })}; or restore the kit version.`,
        );
      }
      continue;
    }

    operations.push({
      action: 'update',
      path: managedPath,
      summary: `Update managed file from kit version ${kitVersion}.`,
      content: payloadContent,
      before: currentContent,
    });
  }
  return { released, releasedOnRequest, recorded, conflicted };
}

/**
 * Warn about kit files that exist in the target, are not managed there, and differ from the kit's
 * version: released files, and files the project put at a kit path. Never a conflict or drift.
 */
function planDetachedFileWarnings(
  inventory: TargetInventory,
  state: InstallState,
  payload: PackagePayload,
  operations: Operation[],
): void {
  const reported = new Set(operations.map((operation) => operation.path));
  for (const [target, kitFile] of listKitManagedFiles(payload)) {
    const currentContent = inventory.contents[target];
    if (Object.hasOwn(state.managedFiles, target) || reported.has(target) || currentContent === undefined) {
      continue;
    }
    if (currentContent !== kitFile.content) {
      operations.push({
        action: 'warning',
        path: target,
        summary: `Not managed by the kit and differs from kit version ${payload.manifest.kitVersion}; it is project-owned, so sync leaves it alone and it will not receive kit updates.`,
      });
    }
  }
}

function planManagedBlocks(inventory: TargetInventory, state: InstallState, operations: Operation[]): void {
  if (state.managedBlocks) {
    for (const [blockKey, entry] of Object.entries(state.managedBlocks)) {
      const [filePath, identifier] = blockKey.split('#');
      if (!filePath || !identifier) continue;
      const fileContent = inventory.contents[filePath];
      if (fileContent === undefined) {
        operations.push({
          action: 'conflict',
          path: filePath,
          summary: `Managed block container ${filePath} is missing.`,
        });
        continue;
      }

      const block = extractManagedBlock(fileContent, identifier);
      if (block === null) {
        operations.push({
          action: 'conflict',
          path: filePath,
          summary: `Managed block <!-- ${identifier}:start --> was removed. Restore the block, markers included, from version control, then run \`drakom-ai sync\` again.`,
        });
        continue;
      }

      const blockFp = fingerprint(block);
      const normalizedBlock = block.replace(/\r\n/g, '\n');
      const normalizedBlockWithNl = normalizedBlock.endsWith('\n') ? normalizedBlock : `${normalizedBlock}\n`;
      const isMatch = [blockFp, fingerprint(normalizedBlock), fingerprint(normalizedBlockWithNl)].includes(
        entry.fingerprint,
      );

      if (!isMatch) {
        operations.push({
          action: 'conflict',
          path: filePath,
          summary: `Managed block <!-- ${identifier}:start --> was locally modified. Restore the block between its markers from version control; content outside the markers is yours to edit.`,
        });
      } else {
        const canonicalBlock = `${MANAGED_BLOCK}\n`;
        const canonicalFp = fingerprint(canonicalBlock);
        if (blockFp !== canonicalFp && fingerprint(normalizedBlockWithNl) !== canonicalFp) {
          const updatedContent = fileContent.replace(block, () => canonicalBlock);
          operations.push({
            action: 'update',
            path: filePath,
            summary: `Update managed block in ${filePath} to latest canonical kit version.`,
            content: updatedContent,
            before: fileContent,
          });
        } else {
          operations.push({
            action: 'preserve',
            path: filePath,
            summary: 'Managed block is up to date.',
          });
        }
      }
    }
  }
}

interface SkillMirrorPlan {
  /** Mirror paths the plan manages as files. */
  mirrorPaths: Set<string>;
  /** Mirror paths that a symlink to the canonical skill replaces; their records are dropped. */
  linkedMirrorPaths: Set<string>;
}

/** Derive mirror ownership records from planned mirror operations. */
function recordSkillMirrors(
  inventory: TargetInventory,
  operations: Operation[],
  mirrorPlan: SkillMirrorPlan,
  recorded: Record<string, { fingerprint: string }>,
): Record<string, { fingerprint: string }> {
  const canonicalSkillMirrorPaths = mirrorPlan.mirrorPaths;
  const updatedSkillMirrors = { ...recorded };
  for (const linkedPath of mirrorPlan.linkedMirrorPaths) {
    delete updatedSkillMirrors[linkedPath];
  }
  for (const op of operations) {
    if ((op.action === 'create' || op.action === 'update') && op.path.startsWith('.claude/skills/') && op.content) {
      updatedSkillMirrors[op.path] = { fingerprint: fingerprint(op.content) };
    } else if (op.action === 'delete' && op.path.startsWith('.claude/skills/')) {
      delete updatedSkillMirrors[op.path];
    } else if (op.action === 'preserve' && canonicalSkillMirrorPaths.has(op.path)) {
      if (!(op.path in updatedSkillMirrors) && inventory.contents[op.path] !== undefined) {
        updatedSkillMirrors[op.path] = { fingerprint: fingerprint(inventory.contents[op.path]!) };
      }
    }
  }
  return updatedSkillMirrors;
}

/**
 * Plan Claude mirrors for canonical skills. When `onlySkillPaths` is given, mirror only those
 * skills and leave project-owned skills and stale mirrors for `sync` to reconcile.
 */
function planSkillMirrors(
  inventory: TargetInventory,
  state: InstallState,
  operations: Operation[],
  onlySkillPaths?: Set<string>,
): SkillMirrorPlan {
  const canonicalSkillMirrorPaths = new Set<string>();
  const linkedMirrorPaths = new Set<string>();
  if (state.features.skillMirrors !== false) {
    const canonicalSkills: Array<{ name: string; path: string; content: string; createdByPlan: boolean }> = [];
    const plannedCreates = operations
      .filter((op) => op.action === 'create' && !inventory.skillFiles.includes(op.path))
      .map((op) => op.path);
    for (const skillPath of [...inventory.skillFiles, ...plannedCreates]) {
      const match = skillPath.match(/^\.agents\/skills\/([^/]+)\/SKILL\.md$/);
      const plannedWrite = operations.find(
        (op) => (op.action === 'update' || op.action === 'create') && op.path === skillPath,
      );
      const effectiveContent = plannedWrite?.content ?? inventory.contents[skillPath];
      if (onlySkillPaths !== undefined && !onlySkillPaths.has(skillPath)) {
        continue;
      }
      if (match?.[1] && effectiveContent !== undefined) {
        canonicalSkills.push({
          name: match[1],
          path: skillPath,
          content: effectiveContent,
          createdByPlan: plannedCreates.includes(skillPath),
        });
      }
    }

    const canonicalNames = new Set(canonicalSkills.map((s) => s.name));
    const reportedLinks = new Set<string>();

    for (const skill of canonicalSkills) {
      const targetDir = `.claude/skills/${skill.name}`;
      const targetFile = `${targetDir}/SKILL.md`;
      const link = findMirrorLink(inventory, skill.name, skill.createdByPlan);
      if (link.kind === 'canonical') {
        linkedMirrorPaths.add(targetFile);
        if (!reportedLinks.has(link.linkPath)) {
          reportedLinks.add(link.linkPath);
          const wholeDirectory = link.linkPath === '.claude/skills';
          operations.push({
            action: 'preserve',
            path: link.linkPath,
            summary: wholeDirectory
              ? `Linked to the canonical ${link.canonicalPath}; Claude reads every skill through the link, so no mirrors are needed.`
              : `Linked to the canonical ${link.canonicalPath}; Claude reads the skill through the link, so no mirror is needed.`,
          });
        }
        continue;
      }
      if (link.kind === 'other') {
        if (!reportedLinks.has(link.linkPath)) {
          reportedLinks.add(link.linkPath);
          operations.push(symlinkConflict(link.linkPath, link.summary));
        }
        continue;
      }
      canonicalSkillMirrorPaths.add(targetFile);
      const expectedContent = createMirrorContent(skill.content);

      const targetExists = inventory.pathSet.has(targetFile);
      const targetDirExists = inventory.pathSet.has(targetDir) || inventory.pathSet.has(`${targetDir}/`);

      if (targetDirExists && !targetExists) {
        operations.push({
          action: 'conflict',
          path: targetDir,
          summary: `Hand-authored Claude skill collides with canonical skill: ${targetDir}`,
        });
        continue;
      }

      if (targetExists) {
        const currentTargetContent = inventory.contents[targetFile] ?? '';
        if (!isGeneratedMirrorContent(currentTargetContent)) {
          operations.push({
            action: 'conflict',
            path: targetFile,
            summary: `Hand-authored Claude skill collides with canonical skill: ${targetFile}`,
          });
          continue;
        }

        const recordedMirror = state.managedSkillMirrors?.[targetFile];
        const currentTargetFp = fingerprint(currentTargetContent);
        if (recordedMirror !== undefined) {
          if (currentTargetFp !== recordedMirror.fingerprint) {
            operations.push({
              action: 'conflict',
              path: targetFile,
              summary: `Claude skill mirror for ${skill.name} was locally modified. Mirrors are generated: move any edit you want to keep into ${skill.path}, delete the folder ${targetDir}, then run \`drakom-ai sync\` again to regenerate it.`,
            });
            continue;
          }
        } else {
          const isExactMatch = currentTargetContent === expectedContent;
          if (!isExactMatch) {
            operations.push({
              action: 'conflict',
              path: targetFile,
              summary: `Claude skill mirror for ${skill.name} is unrecorded and does not match the canonical skill. Move any edit you want to keep into ${skill.path}, delete the folder ${targetDir}, then run \`drakom-ai sync\` again to regenerate it.`,
            });
            continue;
          }
        }

        if (currentTargetContent !== expectedContent) {
          operations.push({
            action: 'update',
            path: targetFile,
            summary: `Update Claude skill mirror for ${skill.name}.`,
            content: expectedContent,
            before: currentTargetContent,
          });
        } else {
          operations.push({
            action: 'preserve',
            path: targetFile,
            summary: `Claude skill mirror for ${skill.name} is up to date.`,
          });
        }
      } else {
        operations.push({
          action: 'create',
          path: targetFile,
          summary: `Create Claude skill mirror for ${skill.name}.`,
          content: expectedContent,
        });
      }
    }

    // Stale mirrors in .claude/skills/. Skip them when the canonical skills sit behind a symlink and
    // cannot be read, since every mirror would then look stale; the write guard reports that link.
    const canonicalSkillsReadable = findSymlinkOnPath(inventory, '.agents/skills') === undefined;
    for (const skillPath of onlySkillPaths === undefined && canonicalSkillsReadable ? inventory.skillFiles : []) {
      const match = skillPath.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/);
      if (match?.[1]) {
        const mirrorName = match[1];
        if (!canonicalNames.has(mirrorName)) {
          const content = inventory.contents[skillPath] ?? '';
          if (isGeneratedMirrorContent(content)) {
            const recordedMirror = state.managedSkillMirrors?.[skillPath];
            const currentFp = fingerprint(content);
            if (recordedMirror !== undefined) {
              if (currentFp !== recordedMirror.fingerprint) {
                operations.push({
                  action: 'conflict',
                  path: skillPath,
                  summary: `Stale Claude skill mirror for ${mirrorName} was locally modified, so it is not deleted. Delete it yourself if it is no longer needed.`,
                });
              } else {
                operations.push({
                  action: 'delete',
                  path: skillPath,
                  summary: `Remove stale Claude skill mirror for ${mirrorName}.`,
                  before: content,
                });
              }
            } else {
              operations.push({
                action: 'conflict',
                path: skillPath,
                summary: `Stale Claude skill mirror for ${mirrorName} is unrecorded, so it is not deleted. Delete it yourself if it is no longer needed.`,
              });
            }
          } else {
            operations.push({
              action: 'preserve',
              path: skillPath,
              summary: `Claude-only hand-authored skill ${mirrorName} preserved.`,
            });
          }
        }
      }
    }

    // A record for a skill that is no longer canonical is also redundant once a canonical link covers its path.
    for (const recordedPath of Object.keys(state.managedSkillMirrors ?? {})) {
      const name = recordedPath.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/)?.[1];
      if (name !== undefined && !canonicalNames.has(name) && findMirrorLink(inventory, name, false).kind === 'canonical') {
        linkedMirrorPaths.add(recordedPath);
      }
    }
  }

  return { mirrorPaths: canonicalSkillMirrorPaths, linkedMirrorPaths };
}

function isMutation({ action }: Operation): boolean {
  return action === 'mkdir' || action === 'create' || action === 'update' || action === 'delete' || action === 'merge';
}

/** How to get out of a literal-credential conflict, worded for the kind of finding. */
function credentialRemedy(field: string, reason: 'name' | 'value' | undefined): string {
  const useReference = `Secrets must never enter YAML or state: replace the value with a \${VAR} reference`;
  if (reason === 'name') return `${useReference}, or, if it is not a secret, add "${field}" to the server's notSecret list.`;
  if (reason === 'value') {
    return `${useReference}. The value looks like a token or carries URL credentials, so notSecret does not apply.`;
  }
  return `${useReference}.`;
}

interface McpPlan {
  nextManagedMcpServers: Record<string, ManagedMcpServerState>;
  /** True when this plan turns MCP management on for a project initialized with `--skip-mcp`. */
  turnsMcpOn: boolean;
}

function planMcp(inventory: TargetInventory, state: InstallState, operations: Operation[]): McpPlan {
  let nextManagedMcpServers: Record<string, ManagedMcpServerState> = { ...state.managedMcpServers };
  const registryRelPath = `${DRAKOM_DIR}/mcp-servers.yaml`;
  // A project initialized with --skip-mcp opts in by adding the registry file.
  const optingIn = state.features.mcp === false && inventory.contents[registryRelPath] !== undefined;
  let generated = false;
  if (state.features.mcp !== false || optingIn) {
    const registryYaml = inventory.contents[registryRelPath];
    if (registryYaml === undefined) {
      operations.push({
        action: 'conflict',
        path: registryRelPath,
        summary: `MCP source registry ${registryRelPath} is missing. Restore it, then run \`drakom-ai sync\` again.`,
      });
    } else {
      let parsedRegistry: unknown;
      let hasParseError = false;
      let parseErrorCoord = '';
      try {
        parsedRegistry = loadYaml(registryYaml);
      } catch (err) {
        hasParseError = true;
        if (
          typeof err === 'object' &&
          err !== null &&
          'mark' in err &&
          typeof (err as { mark?: unknown }).mark === 'object' &&
          (err as { mark?: { line?: unknown; column?: unknown } }).mark !== null
        ) {
          const mark = (err as { mark: { line?: unknown; column?: unknown } }).mark;
          if (typeof mark.line === 'number' && typeof mark.column === 'number') {
            parseErrorCoord = ` at line ${mark.line + 1}, column ${mark.column + 1}`;
          }
        }
      }

      if (hasParseError) {
        operations.push({
          action: 'conflict',
          path: registryRelPath,
          summary: `Invalid MCP registry YAML syntax${parseErrorCoord}. Safe next action: fix syntax in ${registryRelPath}.`,
        });
      } else {
        const validation = validateMcpRegistry(parsedRegistry);
        if (!validation.valid) {
          operations.push({
            action: 'conflict',
            path: registryRelPath,
            summary: `Invalid MCP configuration: ${validation.error}. Safe next action: correct schema in ${registryRelPath}.`,
          });
        } else {
          let hasRegistryErrors = false;
          for (const [serverName, serverDef] of Object.entries(validation.registry.servers)) {
            const cred = checkLiteralCredentials(serverDef, '', new Set(serverDef.notSecret));
            if (cred.hasCredentials) {
              operations.push({
                action: 'conflict',
                path: registryRelPath,
                summary: `MCP registry server "${serverName}" contains literal credentials in ${cred.field}. ${credentialRemedy(cred.field ?? '', cred.reason)}`,
              });
              hasRegistryErrors = true;
            }
          }

          if (!hasRegistryErrors) {
            try {
              const mcpGenResult = generateMcpOperations(validation.registry, inventory, state);
              if (mcpGenResult.operations.some(({ action }) => action === 'conflict')) {
                // Server records span every client file, so one MCP conflict holds back all MCP writes.
                operations.push(...mcpGenResult.operations.filter((operation) => !isMutation(operation)));
              } else {
                operations.push(...mcpGenResult.operations);
                nextManagedMcpServers = mcpGenResult.nextManagedMcpServers;
                generated = true;
              }
            } catch (err) {
              operations.push({
                action: 'conflict',
                path: registryRelPath,
                summary: `MCP generation failed: ${err instanceof Error ? err.message : String(err)}`,
              });
            }
          }
        }
      }
    }
  }

  return { nextManagedMcpServers, turnsMcpOn: optingIn && generated };
}

/**
 * Plan the state write for everything the plan applies. Records of conflicting items are left
 * exactly as they were. Returns whether the state file needs a write.
 */
function planStateUpdate(
  inventory: TargetInventory,
  state: InstallState,
  payload: PackagePayload,
  operations: Operation[],
  mirrorPlan: SkillMirrorPlan,
  mcpPlan: McpPlan,
  addedManagedFiles: Record<string, ManagedFileState>,
  managedFilePlan: ManagedFilePlan,
  keepKitVersion: boolean,
): boolean {
  const updatedManagedFiles: Record<string, ManagedFileState> = {
    ...state.managedFiles,
    ...managedFilePlan.recorded,
    ...addedManagedFiles,
  };
  for (const releasedPath of managedFilePlan.released) {
    delete updatedManagedFiles[releasedPath];
  }
  for (const op of operations) {
    if (op.action === 'update' && op.path in updatedManagedFiles && op.content) {
      const existing = updatedManagedFiles[op.path];
      if (existing) {
        updatedManagedFiles[op.path] = { source: existing.source, fingerprint: fingerprint(op.content) };
      }
    }
  }

  const updatedManagedBlocks: Record<string, { fingerprint: string }> | undefined = state.managedBlocks
    ? { ...state.managedBlocks }
    : undefined;
  if (updatedManagedBlocks) {
    for (const op of operations) {
      if (op.action === 'update' && op.path === 'AGENTS.md') {
        updatedManagedBlocks['AGENTS.md#drakom-ai'] = {
          fingerprint: fingerprint(`${MANAGED_BLOCK}\n`),
        };
      }
    }
  }

  const updatedSkillMirrors = recordSkillMirrors(inventory, operations, mirrorPlan, state.managedSkillMirrors ?? {});

  const updatedState: InstallState = {
    ...state,
    kitVersion: keepKitVersion ? state.kitVersion : payload.manifest.kitVersion,
    managedFiles: updatedManagedFiles,
    managedSkillMirrors: updatedSkillMirrors,
    managedMcpServers: mcpPlan.nextManagedMcpServers,
  };
  if (mcpPlan.turnsMcpOn) {
    updatedState.features = { ...state.features, mcp: true };
  }
  if (updatedManagedBlocks !== undefined) {
    updatedState.managedBlocks = updatedManagedBlocks;
  }
  if (managedFilePlan.releasedOnRequest.size > 0) {
    updatedState.releasedFiles = [...(state.releasedFiles ?? []), ...managedFilePlan.releasedOnRequest];
  }

  const newSerializedState = serializeState(updatedState);
  const currentSerializedState = inventory.contents[`${DRAKOM_DIR}/state.json`] ?? '';
  const needsWrite = newSerializedState !== currentSerializedState;

  if (needsWrite) {
    const stateSummary = operations.some(({ action }) => action === 'conflict')
      ? 'Update installation state for the applied changes; records of conflicting items are left as they are.'
      : 'Update installation state with latest fingerprints and kit version.';
    operations.push({
      action: 'update',
      path: `${DRAKOM_DIR}/state.json`,
      summary: mcpPlan.turnsMcpOn
        ? `Turn on MCP management, because ${DRAKOM_DIR}/mcp-servers.yaml now exists. ${stateSummary}`
        : stateSummary,
      content: newSerializedState,
      before: currentSerializedState,
    });
  } else {
    operations.push({
      action: 'preserve',
      path: `${DRAKOM_DIR}/state.json`,
      summary: 'Installation state is up to date.',
    });
  }

  return needsWrite;
}

/**
 * Hold back the Claude mirror of every skill whose canonical file was not settled by this plan: a
 * managed file in conflict, or a write that was refused. An unresolved edit or deletion is then
 * not copied to, or removed from, `.claude/skills/`, and no mirror is made for a skill that was
 * not written.
 */
function holdMirrorsOfUnsettledSkills(operations: Operation[], unsettledSkillFiles: Iterable<string>): void {
  for (const skillPath of unsettledSkillFiles) {
    const name = skillPath.match(/^\.agents\/skills\/([^/]+)\/SKILL\.md$/)?.[1];
    if (name === undefined) continue;
    const mirrorPath = `.claude/skills/${name}/SKILL.md`;
    for (const [index, operation] of operations.entries()) {
      if (operation.path === mirrorPath && isMutation(operation)) {
        operations[index] = {
          action: 'preserve',
          path: mirrorPath,
          summary: `Claude skill mirror for ${name} is left as it is until the conflict on ${skillPath} is resolved.`,
        };
      }
    }
  }
}

const NO_RESOLUTIONS: ManagedFileResolutions = { accept: new Set(), release: new Set() };

/**
 * Purely derive a synchronization plan from an already-captured inventory. A conflict holds back
 * only its own item (for MCP, all MCP client files); the rest of the plan can still be applied.
 */
export function buildSyncPlan(
  inventory: TargetInventory,
  payload: PackagePayload,
  resolutions: ManagedFileResolutions = NO_RESOLUTIONS,
): OperationPlan {
  let operations: Operation[] = [];
  const state = inventory.state;
  if (!state) {
    throw new Error('Target is not an initialized Drakom installation; run init first.');
  }

  const managedFilePlan = planManagedFiles(inventory, state, payload, operations, resolutions);
  const defaultsStart = operations.length;
  const plannedManagedFiles = planNewDefaults(inventory, state, payload, operations);
  const defaultOperations = operations.slice(defaultsStart);
  planDetachedFileWarnings(inventory, state, payload, operations);
  planManagedBlocks(inventory, state, operations);
  const mirrorPlan = planSkillMirrors(inventory, state, operations);
  const mcpStart = operations.length;
  let mcpPlan = planMcp(inventory, state, operations);
  const mcpMutations = operations.slice(mcpStart).filter(isMutation);

  // Guard before the state update so that state records only what survives, and again after for the state file itself.
  const planned = operations;
  operations = refuseUnrecognisedSymlinks(inventory, operations);
  const surviving = new Set(operations);
  const refusedWrites = planned.filter((operation) => isMutation(operation) && !surviving.has(operation));
  holdMirrorsOfUnsettledSkills(operations, [...managedFilePlan.conflicted, ...refusedWrites.map(({ path }) => path)]);
  if (mcpMutations.some((operation) => !surviving.has(operation))) {
    operations = operations.filter((operation) => !mcpMutations.includes(operation));
    mcpPlan = { nextManagedMcpServers: { ...state.managedMcpServers }, turnsMcpOn: false };
  }
  const addedManagedFiles: Record<string, ManagedFileState> = {};
  for (const operation of defaultOperations) {
    const added = plannedManagedFiles[operation.path];
    if (operation.action === 'create' && surviving.has(operation) && added !== undefined) {
      addedManagedFiles[operation.path] = added;
    }
  }
  // A default that could not be installed is offered again only while the recorded version predates it.
  const keepKitVersion = Object.keys(addedManagedFiles).length < defaultOperations.length;
  const needsStateWrite = planStateUpdate(
    inventory,
    state,
    payload,
    operations,
    mirrorPlan,
    mcpPlan,
    addedManagedFiles,
    managedFilePlan,
    keepKitVersion,
  );

  operations.push({
    action: 'preserve',
    path: '*',
    summary: 'Preserve all existing files not explicitly listed for updates.',
  });
  operations = refuseUnrecognisedSymlinks(inventory, operations);
  const stateWritable =
    !needsStateWrite ||
    operations.some(({ action, path }) => action === 'update' && path === `${DRAKOM_DIR}/state.json`);

  return {
    command: 'sync',
    root: inventory.root,
    targetStatus: inventory.status,
    operations,
    hasConflicts: operations.some(({ action }) => action === 'conflict'),
    // Nothing may be applied when the state that would record it cannot be written.
    partialApply: stateWritable,
  };
}
