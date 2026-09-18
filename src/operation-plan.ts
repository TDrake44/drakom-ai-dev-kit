import { createHash } from 'node:crypto';
import { load as loadYaml } from 'js-yaml';

import type { TargetInventory } from './inspect-target.js';
import { checkLiteralCredentials } from './mcp-discovery.js';
import { generateMcpOperations, validateMcpRegistry } from './mcp-generation.js';
import type { PackagePayload } from './package-payload.js';
import { compareVersions, DRAKOM_DIR, serializeState, type InstallState, type ManagedMcpServerState } from './state.js';

export { compareVersions, DRAKOM_DIR };

export const MANAGED_BLOCK = `<!-- drakom-ai:start -->
## Drakom AI Development Context

Project-specific AI context is stored under \`${DRAKOM_DIR}/\`.
Use \`$drakom-ai-setup\` to assess or revise the project's agent configuration.
<!-- drakom-ai:end -->`;

export const NOTICE =
  '<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "pnpm skills:sync" to update. -->';
export const LEGACY_NOTICE =
  '<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "pnpm run skills:sync" to update. -->';

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
  operations: Operation[];
  hasConflicts: boolean;
}

export function fingerprint(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

export function isGeneratedMirrorContent(content: string): boolean {
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
  const body = frontmatter ? content.slice(frontmatter.length).replace(/^(?:\r?\n)*/, '') : content;
  return [NOTICE, LEGACY_NOTICE].some(
    (marker) => body === marker || body.startsWith(`${marker}\n`) || body.startsWith(`${marker}\r\n`),
  );
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
      path: `${DRAKOM_DIR}/state.json`,
      summary: 'Existing Drakom installation remains unchanged by this preview.',
    });
  } else if (inventory.hasDrakomDirectory) {
    operations.push({
      action: 'conflict',
      path: DRAKOM_DIR,
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
      managedSkillMirrors: {},
      managedMcpServers: {},
    };
    addCreate(`${DRAKOM_DIR}/state.json`, serializeState(state), 'Record managed ownership after all other operations succeed.');
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

/** Purely derive a synchronization plan from an already-captured inventory. */
export function buildSyncPlan(
  inventory: TargetInventory,
  payload: PackagePayload,
): OperationPlan {
  const operations: Operation[] = [];
  const state = inventory.state;
  if (!state) {
    throw new Error('Target is not an initialized Drakom installation; run init first.');
  }

  // Phase 1: Kit-managed files
  const payloadSourceToContent = new Map<string, string>();
  for (const [key, sourceRel] of Object.entries(payload.manifest.files)) {
    const fileContent = payload.files[key];
    if (fileContent !== undefined) {
      payloadSourceToContent.set(sourceRel, fileContent);
    }
  }

  for (const [managedPath, entry] of Object.entries(state.managedFiles)) {
    const currentContent = inventory.contents[managedPath];
    if (currentContent === undefined) {
      operations.push({
        action: 'conflict',
        path: managedPath,
        summary: 'Managed file is missing; restore it before synchronizing.',
      });
      continue;
    }

    const currentFp = fingerprint(currentContent);
    if (currentFp !== entry.fingerprint) {
      operations.push({
        action: 'conflict',
        path: managedPath,
        summary: 'Managed file was locally modified; resolve changes before synchronizing.',
      });
      continue;
    }

    const payloadContent = payloadSourceToContent.get(entry.source);
    if (payloadContent !== undefined) {
      const payloadFp = fingerprint(payloadContent);
      if (payloadFp !== currentFp) {
        operations.push({
          action: 'update',
          path: managedPath,
          summary: `Update managed file from kit version ${payload.manifest.kitVersion}.`,
          content: payloadContent,
          before: currentContent,
        });
      } else {
        operations.push({
          action: 'preserve',
          path: managedPath,
          summary: 'Kit-managed file is up to date.',
        });
      }
    } else {
      operations.push({
        action: 'conflict',
        path: managedPath,
        summary: `Managed file source ${entry.source} is missing from package payload; review payload evolution.`,
      });
    }
  }

  // Managed blocks (e.g. AGENTS.md#drakom-ai)
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
          summary: `Managed block <!-- ${identifier}:start --> was removed; restore it before synchronizing.`,
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
          summary: `Managed block <!-- ${identifier}:start --> was locally modified; resolve changes before synchronizing.`,
        });
      } else {
        const canonicalBlock = `${MANAGED_BLOCK}\n`;
        const canonicalFp = fingerprint(canonicalBlock);
        if (blockFp !== canonicalFp && fingerprint(normalizedBlockWithNl) !== canonicalFp) {
          const updatedContent = fileContent.replace(block, canonicalBlock);
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

  // Phase 2: Claude skill mirrors
  const canonicalSkillMirrorPaths = new Set<string>();
  if (state.features.skillMirrors !== false) {
    const canonicalSkills: Array<{ name: string; path: string; content: string }> = [];
    for (const skillPath of inventory.skillFiles) {
      const match = skillPath.match(/^\.agents\/skills\/([^/]+)\/SKILL\.md$/);
      const skillContent = inventory.contents[skillPath];
      if (match && match[1] && skillContent !== undefined) {
        const plannedUpdate = operations.find((op) => op.action === 'update' && op.path === skillPath);
        const effectiveContent = plannedUpdate?.content ?? skillContent;
        canonicalSkills.push({
          name: match[1],
          path: skillPath,
          content: effectiveContent,
        });
      }
    }

    const canonicalNames = new Set(canonicalSkills.map((s) => s.name));

    for (const skill of canonicalSkills) {
      const targetDir = `.claude/skills/${skill.name}`;
      const targetFile = `${targetDir}/SKILL.md`;
      canonicalSkillMirrorPaths.add(targetFile);
      const expectedContent = createMirrorContent(skill.content);

      const targetExists = inventory.paths.includes(targetFile);
      const targetDirExists = inventory.paths.includes(targetDir) || inventory.paths.includes(`${targetDir}/`);

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
              summary: `Claude skill mirror for ${skill.name} was locally modified; resolve changes before synchronizing.`,
            });
            continue;
          }
        } else {
          const legacyExpectedContent = createMirrorContent(skill.content, LEGACY_NOTICE);
          const isExactMatch =
            currentTargetContent === expectedContent || currentTargetContent === legacyExpectedContent;
          if (!isExactMatch) {
            operations.push({
              action: 'conflict',
              path: targetFile,
              summary: `Claude skill mirror for ${skill.name} is unrecorded and does not match expected content; resolve changes before synchronizing.`,
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

    // Stale mirrors in .claude/skills/
    for (const skillPath of inventory.skillFiles) {
      const match = skillPath.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/);
      if (match && match[1]) {
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
                  summary: `Stale Claude skill mirror for ${mirrorName} was locally modified; resolve changes before deleting.`,
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
                summary: `Stale Claude skill mirror for ${mirrorName} is unrecorded; resolve or remove it manually before synchronizing.`,
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
  }

  // Phase 3: MCP generation
  let nextManagedMcpServers: Record<string, ManagedMcpServerState> = { ...state.managedMcpServers };
  if (state.features.mcp !== false) {
    const registryRelPath = `${DRAKOM_DIR}/mcp-servers.yaml`;
    const registryYaml = inventory.contents[registryRelPath];
    if (registryYaml === undefined) {
      operations.push({
        action: 'conflict',
        path: registryRelPath,
        summary: `MCP source registry ${registryRelPath} is missing; restore it before synchronizing.`,
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
            const cred = checkLiteralCredentials(serverDef);
            if (cred.hasCredentials) {
              operations.push({
                action: 'conflict',
                path: registryRelPath,
                summary: `MCP registry server "${serverName}" contains literal credentials in ${cred.field}. Secrets must never enter YAML or state.`,
              });
              hasRegistryErrors = true;
            }
          }

          if (!hasRegistryErrors) {
            try {
              const mcpGenResult = generateMcpOperations(validation.registry, inventory, state);
              operations.push(...mcpGenResult.operations);
              nextManagedMcpServers = mcpGenResult.nextManagedMcpServers;
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

  // Phase 4: State updates
  const hasConflicts = operations.some((op) => op.action === 'conflict');
  const updatedManagedFiles: Record<string, { source: string; fingerprint: string }> = { ...state.managedFiles };
  for (const op of operations) {
    if (op.action === 'update' && op.path in updatedManagedFiles && op.content) {
      const existing = updatedManagedFiles[op.path];
      if (existing) {
        updatedManagedFiles[op.path] = {
          ...existing,
          fingerprint: fingerprint(op.content),
        };
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

  const updatedSkillMirrors: Record<string, { fingerprint: string }> = {
    ...(state.managedSkillMirrors ?? {}),
  };
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

  const updatedState: InstallState = {
    ...state,
    kitVersion: payload.manifest.kitVersion,
    managedFiles: updatedManagedFiles,
    managedSkillMirrors: updatedSkillMirrors,
    managedMcpServers: nextManagedMcpServers,
  };
  if (updatedManagedBlocks !== undefined) {
    updatedState.managedBlocks = updatedManagedBlocks;
  }

  const newSerializedState = serializeState(updatedState);
  const currentSerializedState = inventory.contents[`${DRAKOM_DIR}/state.json`] ?? '';

  if (newSerializedState !== currentSerializedState && !hasConflicts) {
    operations.push({
      action: 'update',
      path: `${DRAKOM_DIR}/state.json`,
      summary: 'Update installation state with latest fingerprints and kit version.',
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

  operations.push({
    action: 'preserve',
    path: '*',
    summary: 'Preserve all existing files not explicitly listed for updates.',
  });

  return {
    command: 'sync',
    root: inventory.root,
    targetStatus: inventory.status,
    operations,
    hasConflicts,
  };
}
