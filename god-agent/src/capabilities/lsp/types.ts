/**
 * LSP Types
 *
 * Type definitions specific to LSP integration.
 */

export interface LSPServerConfig {
  /** Language ID (e.g., 'typescript', 'javascript') */
  languageId: string;
  /** Server command (e.g., 'typescript-language-server') */
  command: string;
  /** Server arguments */
  args: string[];
  /** File patterns this server handles */
  patterns: string[];
}

export interface LSPConnectionOptions {
  /** Timeout for operations in ms */
  timeout: number;
  /** Root URI for the workspace */
  rootUri: string;
  /** Workspace folders */
  workspaceFolders: Array<{
    uri: string;
    name: string;
  }>;
}

export interface LSPCapabilities {
  definitionProvider: boolean;
  referencesProvider: boolean;
  documentSymbolProvider: boolean;
  workspaceSymbolProvider: boolean;
  diagnosticProvider: boolean;
  hoverProvider: boolean;
  completionProvider: boolean;
  renameProvider: boolean;
}

export interface LSPServerStatus {
  languageId: string;
  running: boolean;
  capabilities: LSPCapabilities;
  error?: string;
}
