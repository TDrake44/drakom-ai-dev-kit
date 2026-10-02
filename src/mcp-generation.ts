import { isDeepStrictEqual } from 'node:util';
import { parse as parseToml } from 'smol-toml';

import { DRAKOM_DIR } from './constants.js';
import type { TargetInventory } from './inspect-target.js';
import { parseJsonc, setJsonValue } from './json-text.js';
import type {
  BaseServerConfig,
  McpRegistry,
} from './mcp-types.js';
import type { Operation } from './operation-plan.js';
import type { InstallState, ManagedMcpServerState } from './state.js';
import { isRecord } from './util.js';
import {
  fingerprintObject,
  generateAntigravityServer,
  generateClaudeServer,
  generateCodexServerSnippet,
  generateVscodeServer,
  sortKeys,
} from './mcp-renderers.js';

export {
  fingerprintObject,
  generateAntigravityServer,
  generateClaudeServer,
  generateCodexServerSnippet,
  generateVscodeServer,
  sortKeys,
} from './mcp-renderers.js';
export { validateMcpRegistry, type McpValidationResult } from './mcp-registry.js';

export const CODEX_BLOCK_START = '# BEGIN Drakom AI Development Context MCP servers';
export const CODEX_BLOCK_END = '# END Drakom AI Development Context MCP servers';
export const LEGACY_CODEX_BLOCK_START = '# BEGIN AI Framework Blueprint MCP servers';
export const LEGACY_CODEX_BLOCK_END = '# END AI Framework Blueprint MCP servers';

interface JsonTargetPreparation {
  operations: Operation[];
  targetFingerprints: Record<string, string>;
}

type JsonParser = (text: string) => unknown;

function editProducedServers(
  content: string,
  containerKey: string,
  expectedServers: Record<string, unknown>,
  parse: JsonParser,
): boolean {
  try {
    const parsed = parse(content);
    return isRecord(parsed) && fingerprintObject(parsed[containerKey]) === fingerprintObject(expectedServers);
  } catch {
    return false;
  }
}

function prepareJsonTarget(
  targetPath: string,
  containerKey: string,
  generatedServers: Record<string, Record<string, unknown>>,
  inventory: TargetInventory,
  state: InstallState,
  parse: JsonParser,
): JsonTargetPreparation {
  const operations: Operation[] = [];
  const targetFingerprints: Record<string, string> = {};
  const currentContent = inventory.contents[targetPath];
  const targetExists = currentContent !== undefined;

  let existing: Record<string, unknown> = {};
  if (targetExists) {
    try {
      const parsed = parse(currentContent);
      if (!isRecord(parsed)) {
        operations.push({
          action: 'conflict',
          path: targetPath,
          summary: `Cannot safely update ${targetPath}: top-level must be a JSON object. Safe next action: fix or remove invalid file.`,
        });
        return { operations, targetFingerprints };
      }
      existing = parsed;
    } catch {
      operations.push({
        action: 'conflict',
        path: targetPath,
        summary: `Cannot safely update ${targetPath}: invalid JSON syntax. Safe next action: fix syntax in ${targetPath}.`,
      });
      return { operations, targetFingerprints };
    }
  }

  const currentServersRaw = existing[containerKey];
  let currentServers: Record<string, unknown> = {};
  if (currentServersRaw !== undefined) {
    if (!isRecord(currentServersRaw)) {
      operations.push({
        action: 'conflict',
        path: targetPath,
        summary: `Cannot safely update ${targetPath}: "${containerKey}" must be an object. Safe next action: ensure "${containerKey}" is a JSON mapping.`,
      });
      return { operations, targetFingerprints };
    }
    currentServers = currentServersRaw;
  }

  // 1. Check previously managed servers for manual edits
  for (const [serverName, serverState] of Object.entries(state.managedMcpServers)) {
    const prevFp = serverState.targetFingerprints[targetPath];
    if (prevFp !== undefined) {
      if (!(serverName in currentServers)) {
        if (serverName in generatedServers) {
          operations.push({
            action: 'conflict',
            path: targetPath,
            summary: `Cannot safely update ${targetPath}: managed MCP server "${serverName}" was removed or edited manually. Safe next action: restore server in ${targetPath} or update ${DRAKOM_DIR}/mcp-servers.yaml.`,
          });
        }
      } else {
        const actualFp = fingerprintObject(currentServers[serverName]);
        if (actualFp !== prevFp) {
          operations.push({
            action: 'conflict',
            path: targetPath,
            summary: `Cannot safely update ${targetPath}: managed MCP server "${serverName}" was edited manually. Safe next action: revert manual edits to ${targetPath} or update ${DRAKOM_DIR}/mcp-servers.yaml.`,
          });
        }
      }
    }
  }

  // 2. Check newly generated servers for collisions with unmanaged servers
  for (const [serverName, generatedServer] of Object.entries(generatedServers)) {
    targetFingerprints[serverName] = fingerprintObject(generatedServer);
    const prevFp = state.managedMcpServers[serverName]?.targetFingerprints[targetPath];
    if (serverName in currentServers && prevFp === undefined) {
      // It exists in current client file but was not managed
      if (!isDeepStrictEqual(sortKeys(currentServers[serverName]), sortKeys(generatedServer))) {
        operations.push({
          action: 'conflict',
          path: targetPath,
          summary: `Cannot safely update ${targetPath}: would replace an existing unmanaged MCP server "${serverName}". Safe next action: rename server or resolve configuration differences.`,
        });
      }
    }
  }

  if (operations.some((op) => op.action === 'conflict')) {
    return { operations, targetFingerprints };
  }

  // 3. Determine managed changes; semantically unchanged entries are left as written
  const removedServers = Object.keys(state.managedMcpServers).filter(
    (serverName) =>
      !(serverName in generatedServers) &&
      Object.hasOwn(currentServers, serverName) &&
      state.managedMcpServers[serverName]?.targetFingerprints[targetPath] !== undefined,
  );
  const changedServers = Object.entries(generatedServers).filter(
    ([serverName]) =>
      !Object.hasOwn(currentServers, serverName) ||
      fingerprintObject(currentServers[serverName]) !== targetFingerprints[serverName],
  );

  if (!targetExists) {
    // If there are no servers to write, do not create an empty file
    if (changedServers.length > 0) {
      operations.push({
        action: 'create',
        path: targetPath,
        summary: `Create MCP client configuration: ${targetPath}.`,
        content: `${JSON.stringify({ [containerKey]: generatedServers }, null, 2)}\n`,
      });
    }
    return { operations, targetFingerprints };
  }

  if (removedServers.length === 0 && changedServers.length === 0) {
    operations.push({
      action: 'preserve',
      path: targetPath,
      summary: `MCP client configuration ${targetPath} is up to date.`,
    });
    return { operations, targetFingerprints };
  }

  // 4. Apply managed changes as minimal text edits so comments and formatting survive
  let newContent = currentContent;
  const expectedServers: Record<string, unknown> = { ...currentServers };
  for (const serverName of removedServers) {
    newContent = setJsonValue(newContent, [containerKey, serverName], undefined);
    delete expectedServers[serverName];
  }
  for (const [serverName, generatedServer] of changedServers) {
    newContent = setJsonValue(newContent, [containerKey, serverName], generatedServer);
    expectedServers[serverName] = generatedServer;
  }

  if (!editProducedServers(newContent, containerKey, expectedServers, parse)) {
    operations.push({
      action: 'conflict',
      path: targetPath,
      summary: `Cannot safely update ${targetPath}: managed MCP edits could not be applied cleanly. Safe next action: check ${targetPath} for duplicate keys or unusual structure.`,
    });
    return { operations, targetFingerprints };
  }

  operations.push({
    action: 'update',
    path: targetPath,
    summary: `Update managed MCP servers in ${targetPath}.`,
    content: newContent,
    before: currentContent,
  });

  return { operations, targetFingerprints };
}

interface CodexBlockExtraction {
  startMarker: string;
  endMarker: string;
  block: string;
  unmanaged: string;
}

function extractCodexBlock(text: string): CodexBlockExtraction | null {
  let startMarker = CODEX_BLOCK_START;
  let endMarker = CODEX_BLOCK_END;
  let startIndex = text.indexOf(startMarker);
  let endIndex = text.indexOf(endMarker);

  if (startIndex === -1 && endIndex === -1) {
    startMarker = LEGACY_CODEX_BLOCK_START;
    endMarker = LEGACY_CODEX_BLOCK_END;
    startIndex = text.indexOf(startMarker);
    endIndex = text.indexOf(endMarker);
  }

  if (startIndex === -1 && endIndex === -1) return null;
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error('Managed MCP block in .codex/config.toml is malformed');
  }

  const endWithNewline = text.indexOf('\n', endIndex + endMarker.length);
  const blockEnd = endWithNewline === -1 ? text.length : endWithNewline + 1;
  const block = text.slice(startIndex, blockEnd);
  const unmanaged = text.slice(0, startIndex) + text.slice(blockEnd);
  return { startMarker, endMarker, block, unmanaged };
}

export function removeCodexServerFromToml(text: string, serverName: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let skipping = false;
  const escapedName = serverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const serverHeaderRegex = new RegExp(
    `^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:"${escapedName}"|'${escapedName}'|${escapedName})(?:\\s*\\.[^\\]]+)?\\s*\\]`,
  );
  const anyHeaderRegex = /^\s*\[/;

  for (const line of lines) {
    if (serverHeaderRegex.test(line)) {
      skipping = true;
      continue;
    } else if (anyHeaderRegex.test(line)) {
      skipping = false;
    }

    if (!skipping) {
      result.push(line);
    }
  }

  return result.join('\n').replace(/\n{3,}/g, '\n\n');
}

interface CodexTargetPreparation {
  operations: Operation[];
  targetFingerprints: Record<string, string>;
}

function renderCodexSnippet(serverName: string, serverDef: BaseServerConfig): string {
  try {
    return generateCodexServerSnippet(serverName, serverDef);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`MCP server "${serverName}": ${detail}`);
  }
}

function prepareCodexTarget(
  generatedServers: Record<string, BaseServerConfig>,
  inventory: TargetInventory,
  state: InstallState,
): CodexTargetPreparation {
  const operations: Operation[] = [];
  const targetFingerprints: Record<string, string> = {};
  const targetPath = '.codex/config.toml';
  const currentContent = inventory.contents[targetPath];
  const targetExists = currentContent !== undefined;
  const existing = currentContent ?? '';

  if (existing.length > 0) {
    try {
      parseToml(existing);
    } catch {
      operations.push({
        action: 'conflict',
        path: targetPath,
        summary: `Cannot safely update ${targetPath}: invalid TOML syntax. Safe next action: fix syntax in ${targetPath}.`,
      });
      return { operations, targetFingerprints };
    }
  }

  let extracted: CodexBlockExtraction | null;
  try {
    extracted = extractCodexBlock(existing);
  } catch {
    operations.push({
      action: 'conflict',
      path: targetPath,
      summary: `Cannot safely update ${targetPath}: malformed managed block markers. Safe next action: restore or remove corrupted block markers.`,
    });
    return { operations, targetFingerprints };
  }

  let unmanaged = existing;
  if (extracted) {
    unmanaged = extracted.unmanaged;
    // Check if previously managed servers were manually edited inside the block
    let parsedBlock: Record<string, unknown> = {};
    try {
      const p = parseToml(extracted.block);
      if (isRecord(p)) parsedBlock = p;
    } catch {
      operations.push({
        action: 'conflict',
        path: targetPath,
        summary: `Cannot safely update ${targetPath}: managed MCP block contains invalid TOML syntax. Safe next action: fix syntax in ${targetPath}.`,
      });
      return { operations, targetFingerprints };
    }

    const blockServers = isRecord(parsedBlock.mcp_servers) ? parsedBlock.mcp_servers : {};
    for (const [serverName, serverState] of Object.entries(state.managedMcpServers)) {
      const prevFp = serverState.targetFingerprints[targetPath];
      if (prevFp !== undefined) {
        if (!(serverName in blockServers)) {
          if (serverName in generatedServers) {
            operations.push({
              action: 'conflict',
              path: targetPath,
              summary: `Cannot safely update ${targetPath}: managed MCP server "${serverName}" was removed or edited manually. Safe next action: restore server in ${targetPath} or update ${DRAKOM_DIR}/mcp-servers.yaml.`,
            });
          }
        } else {
          const actualFp = fingerprintObject(blockServers[serverName]);
          if (actualFp !== prevFp) {
            operations.push({
              action: 'conflict',
              path: targetPath,
              summary: `Cannot safely update ${targetPath}: managed MCP server "${serverName}" was edited manually. Safe next action: revert manual edits to ${targetPath} or update ${DRAKOM_DIR}/mcp-servers.yaml.`,
            });
          }
        }
      }
    }
  }

  // Check if unmanaged section defines any of the generated servers
  let parsedUnmanaged: Record<string, unknown> = {};
  if (unmanaged.trim().length > 0) {
    try {
      const p = parseToml(unmanaged);
      if (isRecord(p)) parsedUnmanaged = p;
    } catch {
      operations.push({
        action: 'conflict',
        path: targetPath,
        summary: `Cannot safely update ${targetPath}: invalid TOML in unmanaged section. Safe next action: fix syntax in ${targetPath}.`,
      });
      return { operations, targetFingerprints };
    }
  }

  const unmanagedServers = parsedUnmanaged.mcp_servers;
  if (isRecord(unmanagedServers)) {
    for (const [serverName, serverDef] of Object.entries(generatedServers)) {
      const prevFp = state.managedMcpServers[serverName]?.targetFingerprints[targetPath];
      if (Object.hasOwn(unmanagedServers, serverName) && prevFp === undefined) {
        const expectedSnippet = renderCodexSnippet(serverName, serverDef);
        let parsedExpectedServer: Record<string, unknown> | null = null;
        try {
          const parsedSnippet = parseToml(expectedSnippet);
          if (isRecord(parsedSnippet) && isRecord(parsedSnippet.mcp_servers)) {
            parsedExpectedServer = parsedSnippet.mcp_servers[serverName] as Record<string, unknown>;
          }
        } catch {
          // Ignore
        }
        if (
          !parsedExpectedServer ||
          !isDeepStrictEqual(sortKeys(unmanagedServers[serverName]), sortKeys(parsedExpectedServer))
        ) {
          operations.push({
            action: 'conflict',
            path: targetPath,
            summary: `Cannot safely update ${targetPath}: would replace an existing unmanaged MCP server "${serverName}". Safe next action: rename server or resolve configuration differences.`,
          });
        } else {
          unmanaged = removeCodexServerFromToml(unmanaged, serverName);
        }
      }
    }
  }

  for (const [name, serverDef] of Object.entries(generatedServers)) {
    const snippet = renderCodexSnippet(name, serverDef);
    let parsedSnippetServer: Record<string, unknown> = {};
    try {
      const p = parseToml(snippet);
      if (isRecord(p) && isRecord(p.mcp_servers) && isRecord(p.mcp_servers[name])) {
        parsedSnippetServer = p.mcp_servers[name] as Record<string, unknown>;
      }
    } catch {
      // Ignore
    }
    targetFingerprints[name] = fingerprintObject(parsedSnippetServer);
  }

  if (operations.some((op) => op.action === 'conflict')) {
    return { operations, targetFingerprints };
  }

  // If there are no servers to generate and no previously managed servers:
  // - If target doesn't exist, do not create it.
  // - If target exists without a managed block, or only has a legacy blueprint block, leave it preserved.
  if (
    Object.keys(generatedServers).length === 0 &&
    Object.keys(state.managedMcpServers).length === 0
  ) {
    if (!targetExists || !extracted || extracted.startMarker === LEGACY_CODEX_BLOCK_START) {
      if (targetExists) {
        operations.push({
          action: 'preserve',
          path: targetPath,
          summary: `MCP client configuration ${targetPath} is up to date.`,
        });
      }
      return { operations, targetFingerprints };
    }
  }

  let generatedBlockBody = '';
  for (const [name, serverDef] of Object.entries(generatedServers)) {
    generatedBlockBody += `${renderCodexSnippet(name, serverDef)}\n`;
  }

  const block = `${CODEX_BLOCK_START}\n${generatedBlockBody}${CODEX_BLOCK_END}\n`;
  const trimmedUnmanaged = unmanaged.trimEnd();
  const cleanUnmanaged = trimmedUnmanaged.trim().length === 0 ? '' : trimmedUnmanaged;
  const separator = cleanUnmanaged.length > 0 ? '\n\n' : '';
  const newContent = cleanUnmanaged.length > 0 ? `${cleanUnmanaged}${separator}${block}` : block;

  try {
    parseToml(newContent);
  } catch {
    operations.push({
      action: 'conflict',
      path: targetPath,
      summary: `Generated TOML for ${targetPath} is invalid. Safe next action: review MCP server configurations.`,
    });
    return { operations, targetFingerprints };
  }

  if (!targetExists) {
    operations.push({
      action: 'create',
      path: targetPath,
      summary: `Create MCP client configuration: ${targetPath}.`,
      content: newContent,
    });
  } else if (newContent !== currentContent) {
    operations.push({
      action: 'update',
      path: targetPath,
      summary: `Update managed MCP block in ${targetPath}.`,
      content: newContent,
      before: currentContent,
    });
  } else {
    operations.push({
      action: 'preserve',
      path: targetPath,
      summary: `MCP client configuration ${targetPath} is up to date.`,
    });
  }

  return { operations, targetFingerprints };
}

export interface McpGenerationResult {
  operations: Operation[];
  nextManagedMcpServers: Record<string, ManagedMcpServerState>;
}

export function generateMcpOperations(
  registry: McpRegistry,
  inventory: TargetInventory,
  state: InstallState,
): McpGenerationResult {
  const operations: Operation[] = [];
  const servers = registry.servers;

  // Generate for each client
  const claudeServers: Record<string, Record<string, unknown>> = {};
  const vscodeServers: Record<string, Record<string, unknown>> = {};
  const agyServers: Record<string, Record<string, unknown>> = {};
  const codexServers: Record<string, BaseServerConfig> = {};

  for (const [name, server] of Object.entries(servers)) {
    try {
      claudeServers[name] = generateClaudeServer(server);
      vscodeServers[name] = generateVscodeServer(server);
      agyServers[name] = generateAntigravityServer(server);
      codexServers[name] = server;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`MCP server "${name}": ${detail}`);
    }
  }

  // Only VS Code documents comments in its MCP file; the other JSON clients stay strict.
  const claudePrep = prepareJsonTarget('.mcp.json', 'mcpServers', claudeServers, inventory, state, JSON.parse);
  const vscodePrep = prepareJsonTarget('.vscode/mcp.json', 'servers', vscodeServers, inventory, state, parseJsonc);
  const agyPrep = prepareJsonTarget('.agents/mcp_config.json', 'mcpServers', agyServers, inventory, state, JSON.parse);
  const codexPrep = prepareCodexTarget(codexServers, inventory, state);

  operations.push(...claudePrep.operations);
  operations.push(...vscodePrep.operations);
  operations.push(...agyPrep.operations);
  operations.push(...codexPrep.operations);

  const nextManagedMcpServers: Record<string, ManagedMcpServerState> = {};
  for (const [name, server] of Object.entries(servers)) {
    const sourceFp = fingerprintObject(server);
    nextManagedMcpServers[name] = {
      sourceFingerprint: sourceFp,
      targetFingerprints: {
        '.mcp.json': claudePrep.targetFingerprints[name] ?? '',
        '.vscode/mcp.json': vscodePrep.targetFingerprints[name] ?? '',
        '.agents/mcp_config.json': agyPrep.targetFingerprints[name] ?? '',
        '.codex/config.toml': codexPrep.targetFingerprints[name] ?? '',
      },
    };
  }

  return {
    operations,
    nextManagedMcpServers,
  };
}
