import { parse as parseToml } from 'smol-toml';

import { isRecord } from './util.js';

export const CODEX_BLOCK_START = '# BEGIN Drakom AI Development Context MCP servers';
export const CODEX_BLOCK_END = '# END Drakom AI Development Context MCP servers';

/** A Codex config split around the managed block; the three parts joined are the file. */
export interface CodexBlockLocation {
  before: string;
  /** From the start marker through the line ending of the end marker. */
  block: string;
  after: string;
}

export function locateCodexBlock(text: string): CodexBlockLocation | null {
  const startIndex = text.indexOf(CODEX_BLOCK_START);
  const endIndex = text.indexOf(CODEX_BLOCK_END);
  if (startIndex === -1 && endIndex === -1) return null;
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error('Managed MCP block in .codex/config.toml is malformed');
  }

  const endWithNewline = text.indexOf('\n', endIndex + CODEX_BLOCK_END.length);
  const blockEnd = endWithNewline === -1 ? text.length : endWithNewline + 1;
  return { before: text.slice(0, startIndex), block: text.slice(startIndex, blockEnd), after: text.slice(blockEnd) };
}

/** Matches the header of a server's table or of one of its sub-tables. */
function codexServerHeaderRegex(serverName: string): RegExp {
  const escapedName = serverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:"${escapedName}"|'${escapedName}'|${escapedName})(?:\\s*\\.[^\\]]+)?\\s*\\]`,
  );
}

/**
 * The lines of one server's tables inside a managed block, as written, without the block markers.
 * Comment lines directly above a table header belong to that table, so they travel with it.
 */
export function extractCodexServerText(block: string, serverName: string, eol: string): string {
  const serverHeaderRegex = codexServerHeaderRegex(serverName);
  const lines = block.split(/\r?\n/);
  const isMarker = (line: string): boolean => line.startsWith('# BEGIN ') || line.startsWith('# END ');
  const isComment = (line: string): boolean => /^\s*#/.test(line) && !isMarker(line);
  // For each line, whether it belongs to this server; decided table by table.
  const kept: string[] = [];
  let keeping = false;
  for (const [index, line] of lines.entries()) {
    if (isMarker(line)) keeping = false;
    else if (/^\s*\[/.test(line)) keeping = serverHeaderRegex.test(line);
    else if (isComment(line)) {
      // A comment run that ends at a table header belongs to that table.
      let next = index + 1;
      while (next < lines.length && isComment(lines[next] ?? '')) next += 1;
      const nextLine = lines[next] ?? '';
      if (/^\s*\[/.test(nextLine)) keeping = serverHeaderRegex.test(nextLine);
    }
    if (keeping) kept.push(line);
  }
  return kept.join(eol).trim();
}

function tryParseToml(text: string): Record<string, unknown> | undefined {
  try {
    return parseToml(text);
  } catch {
    return undefined;
  }
}

type TomlStatement =
  | { kind: 'trivia'; start: number; end: number }
  | { kind: 'header'; start: number; end: number; path: string[] }
  | { kind: 'pair'; start: number; end: number; value: Record<string, unknown> };

/** The key path a table header names: `[a.b]` and `[[a.b]]` both give `['a', 'b']`. */
function headerPath(parsedHeader: Record<string, unknown>): string[] {
  const path: string[] = [];
  let node: unknown = parsedHeader;
  while (isRecord(node)) {
    const [key] = Object.keys(node);
    if (key === undefined) break;
    path.push(key);
    node = node[key];
  }
  return path;
}

/**
 * Splits TOML lines into blank or comment lines, table headers and key/value statements. The
 * extent of a statement is found with the parser itself, so a multi-line string or array is never
 * mistaken for a header. Returns undefined for text this cannot follow.
 */
function scanTomlStatements(lines: readonly string[]): TomlStatement[] | undefined {
  const statements: TomlStatement[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (/^\s*(#|$)/.test(line)) {
      statements.push({ kind: 'trivia', start: index, end: index + 1 });
      index += 1;
    } else if (/^\s*\[/.test(line)) {
      const parsed = tryParseToml(`${line}\n`);
      if (parsed === undefined) return undefined;
      statements.push({ kind: 'header', start: index, end: index + 1, path: headerPath(parsed) });
      index += 1;
    } else {
      let end = index + 1;
      let value = tryParseToml(`${lines.slice(index, end).join('\n')}\n`);
      while (value === undefined && end < lines.length) {
        end += 1;
        value = tryParseToml(`${lines.slice(index, end).join('\n')}\n`);
      }
      if (value === undefined) return undefined;
      statements.push({ kind: 'pair', start: index, end, value });
      index = end;
    }
  }
  return statements;
}

/**
 * Whether a key/value statement, read in the table it sits in, defines the server: `only` when it
 * defines nothing else, `shared` when the same statement also holds other servers.
 */
function pairDefinesServer(
  tablePath: readonly string[],
  value: Record<string, unknown>,
  serverName: string,
): 'only' | 'shared' | 'no' {
  const [table, tableServer] = tablePath;
  let servers: unknown = value;
  if (table === undefined) {
    if (!Object.hasOwn(value, 'mcp_servers')) return 'no';
    servers = value.mcp_servers;
  } else if (table !== 'mcp_servers') {
    return 'no';
  } else if (tableServer !== undefined) {
    return tableServer === serverName ? 'only' : 'no';
  }
  if (!isRecord(servers) || !Object.hasOwn(servers, serverName)) return 'no';
  return Object.keys(servers).length === 1 ? 'only' : 'shared';
}

/**
 * Removes one server from TOML text, however it is written: its `[mcp_servers.<name>]` tables,
 * `mcp_servers.<name> = { … }` and `mcp_servers.<name>.key = …` at the root, and `<name> = { … }`
 * and `<name>.key = …` under `[mcp_servers]`. Every other line is kept byte for byte, with its
 * line ending; comment lines that lead into the next table stay.
 *
 * A server inside an inline table that also holds other servers cannot be cut out and is left in
 * place, so callers must check the result.
 */
export function removeCodexServerFromToml(text: string, serverName: string): string {
  const lines = text.split('\n');
  const statements = scanTomlStatements(lines);
  if (statements === undefined) return text;

  const removed = new Set<number>();
  const isComment = (lineIndex: number): boolean => /^\s*#/.test(lines[lineIndex] ?? '');
  // Blank and comment lines after the last removed statement of a table; a comment run there leads into what follows.
  let trailing: number[] = [];
  const giveBackTrailing = (): void => {
    const firstComment = trailing.findIndex(isComment);
    if (firstComment !== -1) for (const lineIndex of trailing.slice(firstComment)) removed.delete(lineIndex);
    trailing = [];
  };
  const remove = (statement: TomlStatement): void => {
    for (let lineIndex = statement.start; lineIndex < statement.end; lineIndex += 1) removed.add(lineIndex);
  };

  let tablePath: string[] = [];
  let removingTable = false;
  for (const statement of statements) {
    if (statement.kind === 'header') {
      giveBackTrailing();
      tablePath = statement.path;
      removingTable = tablePath[0] === 'mcp_servers' && tablePath[1] === serverName;
      if (removingTable) remove(statement);
    } else if (statement.kind === 'pair') {
      if (removingTable) {
        trailing = [];
        remove(statement);
      } else if (pairDefinesServer(tablePath, statement.value, serverName) === 'only') {
        remove(statement);
      }
    } else if (removingTable) {
      remove(statement);
      trailing.push(statement.start);
    }
  }
  giveBackTrailing();
  // The empty piece after the final line ending is not a line; removing it would drop that ending.
  if (lines[lines.length - 1] === '') removed.delete(lines.length - 1);

  return lines.filter((_line, lineIndex) => !removed.has(lineIndex)).join('\n');
}
