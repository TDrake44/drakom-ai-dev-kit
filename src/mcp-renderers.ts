import { createHash } from 'node:crypto';

import type { BaseServerConfig, ClientOverrideConfig, McpClient, StringMap } from './mcp-types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sortKeys<T>(obj: T): T {
  if (!isRecord(obj)) return obj;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const value = obj[key];
    sorted[key] = isRecord(value) ? sortKeys(value) : value;
  }
  return sorted as T;
}

export function fingerprint(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

export function fingerprintObject(obj: unknown): string {
  return fingerprint(JSON.stringify(sortKeys(obj)));
}

function hasEntries(value: StringMap | undefined): value is StringMap {
  return value !== undefined && Object.keys(value).length > 0;
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined;
}

function resolveServerConfig(server: BaseServerConfig, client: McpClient): ClientOverrideConfig {
  const override = server.overrides?.[client];
  if (!override) {
    const result: ClientOverrideConfig = {};
    if (server.command) result.command = server.command;
    if (server.args) result.args = server.args;
    if (server.env) result.env = server.env;
    if (server.http) result.http = server.http;
    return result;
  }

  const overrideCommand = nonEmptyString(override.command);
  const overrideUrl = nonEmptyString(override.http?.url) ?? nonEmptyString(override.url) ?? nonEmptyString(override.serverUrl);
  const isStdio = overrideCommand !== undefined || (server.command !== undefined && overrideUrl === undefined);

  if (isStdio) {
    const result: ClientOverrideConfig = {};
    const command = override.command ?? server.command;
    if (command) result.command = command;
    const args = override.args ?? server.args;
    if (args) result.args = args;
    if (server.env || override.env) result.env = { ...(server.env ?? {}), ...(override.env ?? {}) };
    return result;
  }

  const url = overrideUrl ?? server.http?.url;
  const type = override.http?.type ?? override.type ?? override.transport ?? server.http?.type;
  const headers = { ...(server.http?.headers ?? {}), ...(override.http?.headers ?? {}), ...(override.headers ?? {}) };
  const result: ClientOverrideConfig = {};
  if (url) {
    result.url = url;
    result.serverUrl = url;
    result.http = { url, ...(type ? { type } : {}), ...(Object.keys(headers).length > 0 ? { headers } : {}) };
  }
  if (type) {
    result.type = type;
    result.transport = type;
  }
  if (Object.keys(headers).length > 0) result.headers = headers;
  if (override.timeout !== undefined) result.timeout = override.timeout;
  return result;
}

function generateJsonServer(server: BaseServerConfig, client: 'claude' | 'vscode'): Record<string, unknown> {
  const resolved = resolveServerConfig(server, client);
  const url = resolved.http?.url ?? resolved.url;
  const headers = resolved.http?.headers ?? resolved.headers;
  if (url) {
    return {
      type: resolved.http?.type ?? resolved.type ?? 'http',
      url,
      ...(hasEntries(headers) ? { headers } : {}),
    };
  }
  return {
    ...(client === 'vscode' ? { type: 'stdio' } : {}),
    ...(resolved.command ? { command: resolved.command } : {}),
    ...(resolved.args ? { args: resolved.args } : {}),
    ...(hasEntries(resolved.env) ? { env: resolved.env } : {}),
  };
}

export function generateClaudeServer(server: BaseServerConfig): Record<string, unknown> {
  return generateJsonServer(server, 'claude');
}

export function generateVscodeServer(server: BaseServerConfig): Record<string, unknown> {
  return generateJsonServer(server, 'vscode');
}

export function generateAntigravityServer(server: BaseServerConfig): Record<string, unknown> {
  const resolved = resolveServerConfig(server, 'antigravity');
  const url = resolved.serverUrl ?? resolved.http?.url ?? resolved.url;
  if (url) {
    const transport = resolved.transport ?? resolved.http?.type ?? resolved.type;
    const headers = resolved.headers ?? resolved.http?.headers;
    return {
      serverUrl: url,
      ...(transport ? { transport } : {}),
      ...(resolved.timeout !== undefined ? { timeout: resolved.timeout } : {}),
      ...(hasEntries(headers) ? { headers } : {}),
    };
  }
  return {
    ...(resolved.command ? { command: resolved.command } : {}),
    ...(resolved.args ? { args: resolved.args } : {}),
    ...(hasEntries(resolved.env) ? { env: resolved.env } : {}),
  };
}

function tomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

export function generateCodexServerSnippet(name: string, server: BaseServerConfig): string {
  const resolved = resolveServerConfig(server, 'codex');
  const serverTable = `mcp_servers.${tomlKey(name)}`;
  const lines = [`[${serverTable}]`];
  if (resolved.command) lines.push(`command = ${JSON.stringify(resolved.command)}`);
  if (resolved.args) lines.push(`args = ${JSON.stringify(resolved.args)}`);
  const url = resolved.http?.url ?? resolved.url ?? resolved.serverUrl;
  if (url) lines.push(`url = ${JSON.stringify(url)}`);
  if (hasEntries(resolved.env)) {
    lines.push('', `[${serverTable}.env]`);
    for (const [key, value] of Object.entries(resolved.env)) lines.push(`${tomlKey(key)} = ${JSON.stringify(value)}`);
  }
  const headers = resolved.http?.headers ?? resolved.headers;
  if (hasEntries(headers)) {
    lines.push('', `[${serverTable}.http_headers]`);
    for (const [key, value] of Object.entries(headers)) lines.push(`${tomlKey(key)} = ${JSON.stringify(value)}`);
  }
  return `${lines.join('\n')}\n`;
}
