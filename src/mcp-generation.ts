import { isDeepStrictEqual } from 'node:util';
import { parse as parseToml } from 'smol-toml';

import { DRAKOM_DIR } from './constants.js';
import type { TargetInventory } from './inspect-target.js';
import { parseJsonc, setJsonValue } from './json-text.js';
import { MCP_CLIENTS, type BaseServerConfig, type McpClient, type McpRegistry } from './mcp-types.js';
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

const REGISTRY_PATH = `${DRAKOM_DIR}/mcp-servers.yaml`;

/** The file each client reads. */
export const MCP_CLIENT_TARGETS: Record<McpClient, string> = {
  claude: '.mcp.json',
  vscode: '.vscode/mcp.json',
  antigravity: '.agents/mcp_config.json',
  codex: '.codex/config.toml',
};

/** What the registry asks of one client file, beyond the servers to generate into it. */
interface TargetSelection {
  client: McpClient;
  /** False when the registry's `clients` list leaves this client out; its file is then never a conflict. */
  selected: boolean;
  /**
   * Servers the kit wrote into this file that the registry no longer wants there, through
   * `clients` or the server's `skip`. An entry still as the kit wrote it is removed; an edited
   * one is left alone. Either way it stops being managed in this file.
   */
  released: ReadonlySet<string>;
}

interface JsonTargetPreparation {
  operations: Operation[];
  targetFingerprints: Record<string, string>;
}

/**
 * A client file the kit cannot work with: a conflict for a selected client, and for a deselected
 * one a warning, because the kit then has nothing left to do with the file.
 */
function unusableTarget(targetPath: string, selection: TargetSelection, problem: string, nextAction: string): Operation {
  if (selection.selected) {
    return {
      action: 'conflict',
      path: targetPath,
      summary: `Cannot safely update ${targetPath}: ${problem}. Safe next action: ${nextAction}`,
    };
  }
  return {
    action: 'warning',
    path: targetPath,
    summary: `${targetPath} is left as it is (${problem}). The MCP servers the kit wrote there are no longer managed, because ${REGISTRY_PATH} no longer selects ${selection.client}.`,
  };
}

function releasedEditedEntry(targetPath: string, serverName: string, selection: TargetSelection, kept: string): Operation {
  return {
    action: 'warning',
    path: targetPath,
    summary: `MCP server "${serverName}" in ${targetPath} was edited after the kit wrote it, so it is ${kept} and is no longer managed; ${REGISTRY_PATH} no longer selects ${selection.client} for it.`,
  };
}

type JsonParser = (text: string) => unknown;

// Own-key lookup, so server names such as "constructor" never resolve to Object.prototype members.
function managedTargetFingerprint(state: InstallState, serverName: string, targetPath: string): string | undefined {
  return Object.hasOwn(state.managedMcpServers, serverName)
    ? state.managedMcpServers[serverName]?.targetFingerprints[targetPath]
    : undefined;
}

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
  selection: TargetSelection,
): JsonTargetPreparation {
  const operations: Operation[] = [];
  const targetFingerprints: Record<string, string> = {};
  const currentContent = inventory.contents[targetPath];
  const targetExists = currentContent !== undefined;
  // A deselected client's file matters only while it may still hold entries the kit wrote.
  if (!selection.selected && (!targetExists || selection.released.size === 0)) {
    return { operations, targetFingerprints };
  }

  let existing: Record<string, unknown> = {};
  if (targetExists) {
    try {
      const parsed = parse(currentContent);
      if (!isRecord(parsed)) {
        operations.push(unusableTarget(targetPath, selection, 'top-level must be a JSON object', 'fix or remove invalid file.'));
        return { operations, targetFingerprints };
      }
      existing = parsed;
    } catch {
      operations.push(unusableTarget(targetPath, selection, 'invalid JSON syntax', `fix syntax in ${targetPath}.`));
      return { operations, targetFingerprints };
    }
  }

  const currentServersRaw = existing[containerKey];
  let currentServers: Record<string, unknown> = {};
  if (currentServersRaw !== undefined) {
    if (!isRecord(currentServersRaw)) {
      operations.push(
        unusableTarget(targetPath, selection, `"${containerKey}" must be an object`, `ensure "${containerKey}" is a JSON mapping.`),
      );
      return { operations, targetFingerprints };
    }
    currentServers = currentServersRaw;
  }

  // 1. Check previously managed servers for manual edits
  const releasedUntouched = new Set<string>();
  for (const [serverName, serverState] of Object.entries(state.managedMcpServers)) {
    const prevFp = serverState.targetFingerprints[targetPath];
    if (prevFp !== undefined) {
      if (selection.released.has(serverName)) {
        if (Object.hasOwn(currentServers, serverName)) {
          if (fingerprintObject(currentServers[serverName]) === prevFp) releasedUntouched.add(serverName);
          else operations.push(releasedEditedEntry(targetPath, serverName, selection, 'left as it is'));
        }
        continue;
      }
      if (!Object.hasOwn(currentServers, serverName)) {
        if (Object.hasOwn(generatedServers, serverName)) {
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
    const prevFp = managedTargetFingerprint(state, serverName, targetPath);
    if (Object.hasOwn(currentServers, serverName) && prevFp === undefined) {
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
      !Object.hasOwn(generatedServers, serverName) &&
      Object.hasOwn(currentServers, serverName) &&
      managedTargetFingerprint(state, serverName, targetPath) !== undefined &&
      (!selection.released.has(serverName) || releasedUntouched.has(serverName)),
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
    if (selection.selected) {
      operations.push({
        action: 'preserve',
        path: targetPath,
        summary: `MCP client configuration ${targetPath} is up to date.`,
      });
    }
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
    operations.push(
      unusableTarget(
        targetPath,
        selection,
        'managed MCP edits could not be applied cleanly',
        `check ${targetPath} for duplicate keys or unusual structure.`,
      ),
    );
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

/** Matches the header of a server's table or of one of its sub-tables. */
function codexServerHeaderRegex(serverName: string): RegExp {
  const escapedName = serverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:"${escapedName}"|'${escapedName}'|${escapedName})(?:\\s*\\.[^\\]]+)?\\s*\\]`,
  );
}

/** The lines of one server's tables inside a managed block, as written, without the block markers. */
function extractCodexServerText(block: string, serverName: string): string {
  const serverHeaderRegex = codexServerHeaderRegex(serverName);
  const kept: string[] = [];
  let keeping = false;
  for (const line of block.split('\n')) {
    if (serverHeaderRegex.test(line)) keeping = true;
    else if (/^\s*\[/.test(line) || line.startsWith('# BEGIN ') || line.startsWith('# END ')) keeping = false;
    if (keeping) kept.push(line);
  }
  return kept.join('\n').trim();
}

export function removeCodexServerFromToml(text: string, serverName: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let skipping = false;
  const serverHeaderRegex = codexServerHeaderRegex(serverName);
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
  selection: TargetSelection,
): CodexTargetPreparation {
  const operations: Operation[] = [];
  const targetFingerprints: Record<string, string> = {};
  const targetPath = MCP_CLIENT_TARGETS.codex;
  const currentContent = inventory.contents[targetPath];
  const targetExists = currentContent !== undefined;
  const existing = currentContent ?? '';
  // A deselected client's file matters only while it may still hold entries the kit wrote.
  if (!selection.selected && (!targetExists || selection.released.size === 0)) {
    return { operations, targetFingerprints };
  }

  if (existing.length > 0) {
    try {
      parseToml(existing);
    } catch {
      operations.push(unusableTarget(targetPath, selection, 'invalid TOML syntax', `fix syntax in ${targetPath}.`));
      return { operations, targetFingerprints };
    }
  }

  let extracted: CodexBlockExtraction | null;
  try {
    extracted = extractCodexBlock(existing);
  } catch {
    operations.push(
      unusableTarget(targetPath, selection, 'malformed managed block markers', 'restore or remove corrupted block markers.'),
    );
    return { operations, targetFingerprints };
  }
  // Without a managed block there is nothing of the kit's left in a deselected client's file.
  if (!selection.selected && !extracted) {
    return { operations, targetFingerprints };
  }

  let unmanaged = existing;
  // Released entries that were edited: their text leaves the managed block and stays in the file.
  const keptEntries: string[] = [];
  if (extracted) {
    unmanaged = extracted.unmanaged;
    // Check if previously managed servers were manually edited inside the block
    let parsedBlock: Record<string, unknown> = {};
    try {
      const p = parseToml(extracted.block);
      if (isRecord(p)) parsedBlock = p;
    } catch {
      operations.push(
        unusableTarget(targetPath, selection, 'managed MCP block contains invalid TOML syntax', `fix syntax in ${targetPath}.`),
      );
      return { operations, targetFingerprints };
    }

    const blockServers = isRecord(parsedBlock.mcp_servers) ? parsedBlock.mcp_servers : {};
    for (const [serverName, serverState] of Object.entries(state.managedMcpServers)) {
      const prevFp = serverState.targetFingerprints[targetPath];
      if (prevFp !== undefined) {
        if (selection.released.has(serverName)) {
          if (Object.hasOwn(blockServers, serverName) && fingerprintObject(blockServers[serverName]) !== prevFp) {
            keptEntries.push(extractCodexServerText(extracted.block, serverName));
            operations.push(releasedEditedEntry(targetPath, serverName, selection, 'kept, outside the managed block,'));
          }
          continue;
        }
        if (!Object.hasOwn(blockServers, serverName)) {
          if (Object.hasOwn(generatedServers, serverName)) {
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
      operations.push(unusableTarget(targetPath, selection, 'invalid TOML in unmanaged section', `fix syntax in ${targetPath}.`));
      return { operations, targetFingerprints };
    }
  }

  const unmanagedServers = parsedUnmanaged.mcp_servers;
  if (isRecord(unmanagedServers)) {
    for (const [serverName, serverDef] of Object.entries(generatedServers)) {
      const prevFp = managedTargetFingerprint(state, serverName, targetPath);
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
  const trimmedUnmanaged = [unmanaged.trimEnd(), ...keptEntries].filter((part) => part.trim().length > 0).join('\n\n');
  const cleanUnmanaged = trimmedUnmanaged.trim().length === 0 ? '' : trimmedUnmanaged;
  const separator = cleanUnmanaged.length > 0 ? '\n\n' : '';
  let newContent = cleanUnmanaged.length > 0 ? `${cleanUnmanaged}${separator}${block}` : block;
  // A deselected client keeps no managed block: only what is not the kit's stays in the file.
  if (!selection.selected) newContent = cleanUnmanaged.length > 0 ? `${cleanUnmanaged}\n` : '';

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
  } else if (selection.selected) {
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
  const selectedClients = new Set<McpClient>(registry.clients ?? MCP_CLIENTS);
  const wants = (client: McpClient, server: BaseServerConfig): boolean =>
    selectedClients.has(client) && !(server.skip ?? []).includes(client);

  // Generate for each client that wants the server
  const claudeServers: Record<string, Record<string, unknown>> = {};
  const vscodeServers: Record<string, Record<string, unknown>> = {};
  const agyServers: Record<string, Record<string, unknown>> = {};
  const codexServers: Record<string, BaseServerConfig> = {};

  for (const [name, server] of Object.entries(servers)) {
    try {
      if (wants('claude', server)) claudeServers[name] = generateClaudeServer(server);
      if (wants('vscode', server)) vscodeServers[name] = generateVscodeServer(server);
      if (wants('antigravity', server)) agyServers[name] = generateAntigravityServer(server);
      if (wants('codex', server)) codexServers[name] = server;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`MCP server "${name}": ${detail}`);
    }
  }

  const selectionFor = (client: McpClient): TargetSelection => {
    const targetPath = MCP_CLIENT_TARGETS[client];
    const released = new Set<string>();
    for (const name of Object.keys(state.managedMcpServers)) {
      if (managedTargetFingerprint(state, name, targetPath) === undefined) continue;
      const server = Object.hasOwn(servers, name) ? servers[name] : undefined;
      // A server that left the registry altogether keeps its existing handling while its client is selected.
      if (!selectedClients.has(client) || (server !== undefined && !wants(client, server))) released.add(name);
    }
    return { client, selected: selectedClients.has(client), released };
  };

  // Only VS Code documents comments in its MCP file; the other JSON clients stay strict.
  const preparations: Record<McpClient, JsonTargetPreparation> = {
    claude: prepareJsonTarget(MCP_CLIENT_TARGETS.claude, 'mcpServers', claudeServers, inventory, state, JSON.parse, selectionFor('claude')),
    vscode: prepareJsonTarget(MCP_CLIENT_TARGETS.vscode, 'servers', vscodeServers, inventory, state, parseJsonc, selectionFor('vscode')),
    antigravity: prepareJsonTarget(
      MCP_CLIENT_TARGETS.antigravity,
      'mcpServers',
      agyServers,
      inventory,
      state,
      JSON.parse,
      selectionFor('antigravity'),
    ),
    codex: prepareCodexTarget(codexServers, inventory, state, selectionFor('codex')),
  };
  for (const client of MCP_CLIENTS) operations.push(...preparations[client].operations);

  // A server is recorded only for the client files it is generated into.
  const nextManagedMcpServers: Record<string, ManagedMcpServerState> = {};
  for (const [name, server] of Object.entries(servers)) {
    const targetFingerprints: Record<string, string> = {};
    for (const client of MCP_CLIENTS) {
      if (wants(client, server)) {
        targetFingerprints[MCP_CLIENT_TARGETS[client]] = preparations[client].targetFingerprints[name] ?? '';
      }
    }
    nextManagedMcpServers[name] = { sourceFingerprint: fingerprintObject(server), targetFingerprints };
  }

  return {
    operations,
    nextManagedMcpServers,
  };
}
