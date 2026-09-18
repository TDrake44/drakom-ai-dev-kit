export type StringMap = Record<string, string>;

export type McpClient = 'claude' | 'vscode' | 'antigravity' | 'codex';

export interface HttpConfig {
  url: string;
  type?: string | undefined;
  headers?: StringMap | undefined;
}

export interface ClientOverrideConfig {
  command?: string | undefined;
  args?: string[] | undefined;
  env?: StringMap | undefined;
  http?: HttpConfig | undefined;
  url?: string | undefined;
  serverUrl?: string | undefined;
  httpUrl?: string | undefined;
  type?: string | undefined;
  transport?: string | undefined;
  headers?: StringMap | undefined;
  timeout?: number | undefined;
}

export interface BaseServerConfig {
  command?: string | undefined;
  args?: string[] | undefined;
  env?: StringMap | undefined;
  http?: HttpConfig | undefined;
  overrides?: Record<string, ClientOverrideConfig> | undefined;
}

export interface McpRegistry {
  servers: Record<string, BaseServerConfig>;
}

export interface NormalizedStdioServer {
  transport: 'stdio';
  command: string;
  args?: string[] | undefined;
  env?: StringMap | undefined;
}

export interface NormalizedHttpServer {
  transport: 'http';
  url: string;
  type?: string | undefined;
  headers?: StringMap | undefined;
}

export type NormalizedServer = NormalizedStdioServer | NormalizedHttpServer;

export type McpClassification =
  | 'identical'
  | 'equivalent_override'
  | 'conflicting'
  | 'unsupported'
  | 'literal_credentials';

export interface DiscoveredServerClientEntry {
  filePath: string;
  client: 'claude' | 'vscode' | 'antigravity' | 'codex';
  raw: unknown;
  normalized?: NormalizedServer | undefined;
  isUnsupported: boolean;
  unsupportedReason?: string | undefined;
  hasCredentials: boolean;
  credentialField?: string | undefined;
}

export interface DiscoveredServerSummary {
  name: string;
  entries: DiscoveredServerClientEntry[];
  classification: McpClassification;
  explanation: string;
  recommendedChoice: 'import' | 'import_with_overrides' | 'leave_unmanaged' | 'skip';
  consolidatedDefinition?: BaseServerConfig | undefined;
}

export interface DiscoveredMcpConfiguration {
  registryPath: string | null;
  registry: McpRegistry | null;
  registryError?: string | undefined;
  fileErrors?: Record<string, string> | undefined;
  clientFiles: string[];
  servers: Map<string, DiscoveredServerSummary>;
}

export type McpImportChoice =
  | 'import'
  | 'import_with_overrides'
  | 'leave_unmanaged'
  | 'skip';
