export type StringMap = Record<string, string>;

export type McpClient = 'claude' | 'vscode' | 'antigravity' | 'codex';

/** Every supported client, in the order their files are generated and recorded. */
export const MCP_CLIENTS: readonly McpClient[] = ['claude', 'vscode', 'antigravity', 'codex'];

/** A map in a client override: a `null` value removes that key from the base server's map. */
export type RemovableStringMap = Record<string, string | null>;

export interface OverrideHttpConfig {
  url: string;
  type?: string | undefined;
  /** `null` removes the base server's headers. */
  headers?: RemovableStringMap | null | undefined;
}

export interface HttpConfig {
  url: string;
  type?: string | undefined;
  headers?: StringMap | undefined;
}

export interface ClientOverrideConfig {
  command?: string | undefined;
  args?: string[] | undefined;
  /** `null` removes the base server's env. */
  env?: RemovableStringMap | null | undefined;
  http?: OverrideHttpConfig | undefined;
  url?: string | undefined;
  serverUrl?: string | undefined;
  httpUrl?: string | undefined;
  type?: string | undefined;
  transport?: string | undefined;
  /** `null` removes the base server's headers. */
  headers?: RemovableStringMap | null | undefined;
  timeout?: number | undefined;
}

export interface BaseServerConfig {
  command?: string | undefined;
  args?: string[] | undefined;
  env?: StringMap | undefined;
  http?: HttpConfig | undefined;
  overrides?: Record<string, ClientOverrideConfig> | undefined;
  /** Clients this server is not generated for. */
  skip?: McpClient[] | undefined;
  /** Field paths, as the credential check prints them, that hold plain values rather than credentials. */
  notSecret?: string[] | undefined;
}

export interface McpRegistry {
  servers: Record<string, BaseServerConfig>;
  /** Clients to generate configuration for; absent means every client. */
  clients?: McpClient[] | undefined;
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
