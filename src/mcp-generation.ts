import { isDeepStrictEqual } from 'node:util';
import { parse as parseToml } from 'smol-toml';

import {
  CODEX_BLOCK_END,
  CODEX_BLOCK_START,
  extractCodexServerText,
  locateCodexBlock,
  removeCodexServerFromToml,
  type CodexBlockLocation,
} from './codex-toml.js';
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
  generateVscodeRootServer,
  generateVscodeServer,
  ignoredAntigravityOverrideKeys,
  sortKeys,
  VscodeInputError,
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

export { CODEX_BLOCK_END, CODEX_BLOCK_START, removeCodexServerFromToml } from './codex-toml.js';

const REGISTRY_PATH = `${DRAKOM_DIR}/mcp-servers.yaml`;

/**
 * The file the kit writes for each client. The root `.mcp.json` is shared: Claude Code reads it,
 * and so does VS Code, whose own `.vscode/mcp.json` belongs to its deprecated Local harness.
 */
export const MCP_CLIENT_TARGETS: Record<McpClient, string> = {
  claude: '.mcp.json',
  vscode: '.vscode/mcp.json',
  antigravity: '.agents/mcp_config.json',
  codex: '.codex/config.toml',
};

/** What the registry asks of one client file, beyond the servers to generate into it. */
interface TargetSelection {
  /** The client, or clients, the file is written for, as named in messages. */
  client: string;
  /** False when the registry's `clients` list leaves the file's clients out; the file is then never a conflict. */
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
        // An entry already edited into exactly what the kit now writes is up to date, and is recorded as such.
        const generated = Object.hasOwn(generatedServers, serverName) ? generatedServers[serverName] : undefined;
        if (actualFp !== prevFp && (generated === undefined || actualFp !== fingerprintObject(generated))) {
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

/** The `mcp_servers` tables of TOML text, or nothing when the text has none or does not parse. */
function codexServersOf(text: string): Record<string, unknown> {
  try {
    const parsed = parseToml(text);
    return isRecord(parsed.mcp_servers) ? parsed.mcp_servers : {};
  } catch {
    return {};
  }
}

/** A Codex config as parsed, without the named servers: what the kit must leave as it found it. */
function codexSettingsOutside(text: string, serverNames: ReadonlySet<string>): Record<string, unknown> | undefined {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(text);
  } catch {
    return undefined;
  }
  const allServers = isRecord(parsed.mcp_servers) ? parsed.mcp_servers : {};
  const servers = Object.entries(allServers).filter(([name]) => !serverNames.has(name));
  const rest = Object.entries(parsed).filter(([key]) => key !== 'mcp_servers');
  return Object.fromEntries(servers.length === 0 ? rest : [...rest, ['mcp_servers', Object.fromEntries(servers)]]);
}

/** Ends non-empty text with a blank line, in the file's line ending, so a table can follow it. */
function withBlankLineEnd(text: string, eol: string): string {
  if (text.trim().length === 0 || /\n[ \t]*\r?\n$/.test(text)) return text;
  return text.endsWith('\n') ? `${text}${eol}` : `${text}${eol}${eol}`;
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

  let located: CodexBlockLocation | null;
  try {
    located = locateCodexBlock(existing);
  } catch {
    operations.push(
      unusableTarget(targetPath, selection, 'malformed managed block markers', 'restore or remove corrupted block markers.'),
    );
    return { operations, targetFingerprints };
  }
  // Without a managed block there is nothing of the kit's left in a deselected client's file.
  if (!selection.selected && !located) {
    return { operations, targetFingerprints };
  }
  // In TOML, keys directly after the block belong to the block's last table, so a rewrite could hand
  // them to a different server. Only comments and blank lines may come before the next table header.
  const looseLine = located?.after.split(/\r?\n/).find((line) => line.trim().length > 0 && !/^\s*#/.test(line));
  if (looseLine !== undefined && !/^\s*\[/.test(looseLine)) {
    operations.push(
      unusableTarget(
        targetPath,
        selection,
        `the text after the managed block must start with a table header, and "${looseLine.trim()}" comes first`,
        'move that line under the table it belongs to, or put a table header above it.',
      ),
    );
    return { operations, targetFingerprints };
  }

  // The block is rewritten where it is: the text on either side of it is the user's.
  let before = located ? located.before : existing;
  let after = located ? located.after : '';
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  // Released entries that were edited: their text leaves the managed block and stays in the file.
  const keptEntries: string[] = [];
  const keptNames = new Set<string>();
  let blockServers: Record<string, unknown> = {};
  const expectedCodexFingerprint = (serverName: string): string | undefined => {
    if (!Object.hasOwn(generatedServers, serverName)) return undefined;
    const generated = generatedServers[serverName];
    if (generated === undefined) return undefined;
    const expected = codexServersOf(renderCodexSnippet(serverName, generated))[serverName];
    return isRecord(expected) ? fingerprintObject(expected) : undefined;
  };
  if (located) {
    // Check if previously managed servers were manually edited inside the block
    try {
      const parsedBlock = parseToml(located.block);
      if (isRecord(parsedBlock.mcp_servers)) blockServers = parsedBlock.mcp_servers;
    } catch {
      operations.push(
        unusableTarget(targetPath, selection, 'managed MCP block contains invalid TOML syntax', `fix syntax in ${targetPath}.`),
      );
      return { operations, targetFingerprints };
    }

    for (const [serverName, serverState] of Object.entries(state.managedMcpServers)) {
      const prevFp = serverState.targetFingerprints[targetPath];
      if (prevFp !== undefined) {
        if (selection.released.has(serverName)) {
          if (Object.hasOwn(blockServers, serverName) && fingerprintObject(blockServers[serverName]) !== prevFp) {
            keptEntries.push(extractCodexServerText(located.block, serverName, eol));
            keptNames.add(serverName);
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
          // An entry already edited into exactly what the kit now writes is up to date, and is recorded as such.
          if (actualFp !== prevFp && actualFp !== expectedCodexFingerprint(serverName)) {
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

  // Check if the text outside the block defines any of the generated servers, in any TOML form
  const outside = `${before}${after}`;
  if (outside.trim().length > 0) {
    try {
      parseToml(outside);
    } catch {
      operations.push(unusableTarget(targetPath, selection, 'invalid TOML in unmanaged section', `fix syntax in ${targetPath}.`));
      return { operations, targetFingerprints };
    }
  }
  const outsideServers = codexServersOf(outside);

  const snippets: Record<string, string> = {};
  for (const [serverName, serverDef] of Object.entries(generatedServers)) {
    const snippet = renderCodexSnippet(serverName, serverDef);
    snippets[serverName] = snippet;
    const expectedServer = codexServersOf(snippet)[serverName];
    targetFingerprints[serverName] = fingerprintObject(isRecord(expectedServer) ? expectedServer : {});
    if (!Object.hasOwn(outsideServers, serverName)) continue;

    const outsideServer = outsideServers[serverName];
    const prevFp = managedTargetFingerprint(state, serverName, targetPath);
    if (prevFp === undefined) {
      if (!isRecord(expectedServer) || !isDeepStrictEqual(sortKeys(outsideServer), sortKeys(expectedServer))) {
        operations.push({
          action: 'conflict',
          path: targetPath,
          summary: `Cannot safely update ${targetPath}: would replace an existing unmanaged MCP server "${serverName}". Safe next action: rename server or resolve configuration differences.`,
        });
        continue;
      }
    } else if (located || fingerprintObject(outsideServer) !== prevFp) {
      // Recorded as the kit's, but defined outside the block: a table or keys the user added to it there
      // (they would attach to whatever the kit writes, or be left behind when it removes the server), or a
      // changed copy in a file whose markers were removed.
      operations.push({
        action: 'conflict',
        path: targetPath,
        summary: `Cannot safely update ${targetPath}: managed MCP server "${serverName}" is defined outside the managed block, in whole or in part, and is not what the kit wrote. Safe next action: remove "${serverName}" from outside the block in ${targetPath} (set what it adds in ${DRAKOM_DIR}/mcp-servers.yaml instead), or rename the server in ${DRAKOM_DIR}/mcp-servers.yaml.`,
      });
      continue;
    }

    // An identical definition is taken over: it leaves the user's text and is written in the block.
    before = removeCodexServerFromToml(before, serverName);
    after = removeCodexServerFromToml(after, serverName);
    if (Object.hasOwn(codexServersOf(`${before}${after}`), serverName)) {
      operations.push({
        action: 'conflict',
        path: targetPath,
        summary: `Cannot safely update ${targetPath}: MCP server "${serverName}" is already defined there, inside an inline table the kit cannot rewrite. Safe next action: write it as a [mcp_servers.${serverName}] table, or remove it so the kit can write it.`,
      });
    }
  }

  if (operations.some((op) => op.action === 'conflict')) {
    return { operations, targetFingerprints };
  }

  // With no servers to generate and none managed before, a file without a managed block is left alone
  // and a missing file is not created.
  if (
    Object.keys(generatedServers).length === 0 &&
    Object.keys(state.managedMcpServers).length === 0 &&
    !located
  ) {
    if (targetExists) {
      operations.push({
        action: 'preserve',
        path: targetPath,
        summary: `MCP client configuration ${targetPath} is up to date.`,
      });
    }
    return { operations, targetFingerprints };
  }

  // The block takes the file's line ending, so a CRLF file never ends up with mixed endings.
  const block = `${CODEX_BLOCK_START}\n${Object.values(snippets)
    .map((snippet) => `${snippet}\n`)
    .join('')}${CODEX_BLOCK_END}\n`.replaceAll('\n', eol);
  const keptText = keptEntries.join(`${eol}${eol}`);
  let newContent: string;
  if (!located) {
    // First block in this file: it goes at the end.
    const unmanaged = before.trimEnd();
    newContent = unmanaged.length > 0 ? `${unmanaged}${eol}${eol}${block}` : block;
  } else if (selection.selected) {
    newContent =
      keptEntries.length === 0
        ? `${before}${block}${after}`
        : `${withBlankLineEnd(before, eol)}${keptText}${eol}${eol}${block}${after}`;
  } else {
    // A deselected client keeps no managed block: only what is not the kit's stays in the file.
    const head = keptEntries.length === 0 ? before : `${withBlankLineEnd(before, eol)}${keptText}${eol}`;
    if (after.trim().length > 0) newContent = `${head}${after}`;
    else newContent = head.trim().length > 0 ? `${head.trimEnd()}${eol}` : '';
  }

  // Everything that is not a server the kit writes or removes must read exactly as it did before.
  const kitServers = new Set([...Object.keys(generatedServers), ...Object.keys(blockServers).filter((name) => !keptNames.has(name))]);
  const settingsAfter = codexSettingsOutside(newContent, kitServers);
  if (settingsAfter === undefined) {
    operations.push({
      action: 'conflict',
      path: targetPath,
      summary: `Generated TOML for ${targetPath} is invalid. Safe next action: review MCP server configurations.`,
    });
    return { operations, targetFingerprints };
  }
  if (!isDeepStrictEqual(settingsAfter, codexSettingsOutside(existing, kitServers))) {
    operations.push(
      unusableTarget(
        targetPath,
        selection,
        'rewriting the managed MCP block would change settings outside it',
        `make sure the text after the managed block in ${targetPath} starts with a table header, not with loose keys.`,
      ),
    );
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

const ROOT_TARGET = MCP_CLIENT_TARGETS.claude;

/**
 * The root `.mcp.json` rendering of one server, and what the user should know about it.
 *
 * Claude Code and VS Code read the same root file, so it holds one version of each server: the
 * claude one while claude is generated for that server, and otherwise the vscode one. A vscode
 * version that differs, or that prompts with `${input:...}`, reaches VS Code only through
 * `.vscode/mcp.json`. A server that skips claude stays out of the root file, which Claude Code reads.
 */
function sharedRootServer(
  name: string,
  server: BaseServerConfig,
  forClaude: boolean,
  forVscode: boolean,
): { rendered?: Record<string, unknown>; note?: Operation } {
  const claudeVersion = forClaude ? generateClaudeServer(server) : undefined;
  if (!forVscode) return claudeVersion ? { rendered: claudeVersion } : {};
  if ((server.skip ?? []).includes('claude')) {
    return {
      note: {
        action: 'warning',
        path: ROOT_TARGET,
        summary: `MCP server "${name}" skips claude, so it is left out of ${ROOT_TARGET}, which Claude Code reads; VS Code's Copilot harness will not see it from ${ROOT_TARGET}, and VS Code gets it from ${MCP_CLIENT_TARGETS.vscode} only.`,
      },
    };
  }

  const vscodeOnly = `its vscode override only applies to ${MCP_CLIENT_TARGETS.vscode}`;
  let vscodeVersion: Record<string, unknown>;
  try {
    vscodeVersion = generateVscodeRootServer(server);
  } catch (error) {
    if (!(error instanceof VscodeInputError)) throw error;
    const cannot = `MCP server "${name}" uses ${error.input} for vscode, which ${ROOT_TARGET} cannot express`;
    const summary = claudeVersion
      ? `${cannot}; ${ROOT_TARGET} holds the claude version, and ${vscodeOnly}.`
      : `${cannot}; the server is left out of ${ROOT_TARGET} and goes to ${MCP_CLIENT_TARGETS.vscode} only.`;
    return { ...(claudeVersion ? { rendered: claudeVersion } : {}), note: { action: 'warning', path: ROOT_TARGET, summary } };
  }
  if (claudeVersion === undefined) return { rendered: vscodeVersion };
  if (isDeepStrictEqual(claudeVersion, vscodeVersion)) return { rendered: claudeVersion };
  return {
    rendered: claudeVersion,
    note: {
      action: 'warning',
      path: ROOT_TARGET,
      summary: `MCP server "${name}" differs between claude and vscode; ${ROOT_TARGET} holds the claude version, and ${vscodeOnly}.`,
    },
  };
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
  const rootServers: Record<string, Record<string, unknown>> = {};
  const vscodeServers: Record<string, Record<string, unknown>> = {};
  const agyServers: Record<string, Record<string, unknown>> = {};
  const codexServers: Record<string, BaseServerConfig> = {};
  const rootNotes: Operation[] = [];
  const registryNotes: Operation[] = [];

  for (const [name, server] of Object.entries(servers)) {
    try {
      const root = sharedRootServer(name, server, wants('claude', server), wants('vscode', server));
      if (root.rendered) rootServers[name] = root.rendered;
      if (root.note) rootNotes.push(root.note);
      if (wants('vscode', server)) vscodeServers[name] = generateVscodeServer(server);
      if (wants('antigravity', server)) {
        agyServers[name] = generateAntigravityServer(server);
        const ignored = ignoredAntigravityOverrideKeys(server).map((key) => `overrides.antigravity.${key}`);
        if (ignored.length > 0) {
          registryNotes.push({
            action: 'warning',
            path: REGISTRY_PATH,
            summary: `MCP server "${name}": ${ignored.join(' and ')} ${ignored.length === 1 ? 'is' : 'are'} no longer written to ${MCP_CLIENT_TARGETS.antigravity}, because Antigravity does not define ${ignored.length === 1 ? 'that field' : 'those fields'}. Remove ${ignored.length === 1 ? 'it' : 'them'} from the registry; to set a timeout, use overrides.antigravity.timeoutSeconds, in seconds.`,
          });
        }
      }
      if (wants('codex', server)) codexServers[name] = server;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`MCP server "${name}": ${detail}`);
    }
  }

  /** The servers each client file is to hold, and whether the registry still selects the file at all. */
  const targets: Array<{ path: string; label: string; selected: boolean; holds: (name: string) => boolean }> = [
    {
      path: ROOT_TARGET,
      label: 'claude or vscode',
      selected: selectedClients.has('claude') || selectedClients.has('vscode'),
      holds: (name) => Object.hasOwn(rootServers, name),
    },
    ...(['vscode', 'antigravity', 'codex'] as const).map((client) => ({
      path: MCP_CLIENT_TARGETS[client],
      label: client,
      selected: selectedClients.has(client),
      holds: (name: string) => Object.hasOwn(servers, name) && wants(client, servers[name] ?? {}),
    })),
  ];

  const selectionFor = (targetPath: string): TargetSelection => {
    const target = targets.find(({ path }) => path === targetPath);
    if (target === undefined) throw new Error(`Unknown MCP client file ${targetPath}`);
    const released = new Set<string>();
    for (const name of Object.keys(state.managedMcpServers)) {
      if (managedTargetFingerprint(state, name, targetPath) === undefined) continue;
      // A server that left the registry altogether keeps its existing handling while its file is selected.
      if (!target.selected || (Object.hasOwn(servers, name) && !target.holds(name))) released.add(name);
    }
    return { client: target.label, selected: target.selected, released };
  };

  // Only VS Code documents comments in its MCP file; the other JSON clients stay strict.
  const preparations: Record<string, JsonTargetPreparation> = {
    [ROOT_TARGET]: prepareJsonTarget(ROOT_TARGET, 'mcpServers', rootServers, inventory, state, JSON.parse, selectionFor(ROOT_TARGET)),
    [MCP_CLIENT_TARGETS.vscode]: prepareJsonTarget(
      MCP_CLIENT_TARGETS.vscode,
      'servers',
      vscodeServers,
      inventory,
      state,
      parseJsonc,
      selectionFor(MCP_CLIENT_TARGETS.vscode),
    ),
    [MCP_CLIENT_TARGETS.antigravity]: prepareJsonTarget(
      MCP_CLIENT_TARGETS.antigravity,
      'mcpServers',
      agyServers,
      inventory,
      state,
      JSON.parse,
      selectionFor(MCP_CLIENT_TARGETS.antigravity),
    ),
    [MCP_CLIENT_TARGETS.codex]: prepareCodexTarget(codexServers, inventory, state, selectionFor(MCP_CLIENT_TARGETS.codex)),
  };
  operations.push(...registryNotes);
  for (const { path } of targets) {
    operations.push(...(preparations[path]?.operations ?? []));
    if (path === ROOT_TARGET) operations.push(...rootNotes);
  }

  // A server is recorded only for the client files it is generated into.
  const nextManagedMcpServers: Record<string, ManagedMcpServerState> = {};
  for (const [name, server] of Object.entries(servers)) {
    const targetFingerprints: Record<string, string> = {};
    for (const target of targets) {
      if (target.selected && target.holds(name)) {
        targetFingerprints[target.path] = preparations[target.path]?.targetFingerprints[name] ?? '';
      }
    }
    nextManagedMcpServers[name] = { sourceFingerprint: fingerprintObject(server), targetFingerprints };
  }

  return {
    operations,
    nextManagedMcpServers,
  };
}
