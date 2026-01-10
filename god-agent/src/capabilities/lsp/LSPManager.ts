/**
 * LSPManager
 *
 * Manages Language Server Protocol connections for IDE-like code intelligence.
 * Supports go-to-definition, find-references, diagnostics, and symbol search.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  MessageConnection,
  InitializeRequest,
  InitializeParams,
  InitializedNotification,
  TextDocumentIdentifier,
  Position,
  DefinitionRequest,
  ReferencesRequest,
  DocumentSymbolRequest,
  WorkspaceSymbolRequest,
  PublishDiagnosticsNotification,
  DidOpenTextDocumentNotification,
  TextDocumentItem
} from 'vscode-languageserver-protocol/node.js';

import type { LSPConfig } from '../types.js';
import type {
  DefinitionResult,
  ReferencesResult,
  DiagnosticsResult,
  SymbolSearchResult,
  LSPDiagnostic
} from '../types.js';
import type { LSPServerConfig, LSPServerStatus, LSPCapabilities } from './types.js';

/**
 * Default language server configurations
 */
const DEFAULT_SERVERS: LSPServerConfig[] = [
  {
    languageId: 'typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    patterns: ['**/*.ts', '**/*.tsx']
  },
  {
    languageId: 'javascript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    patterns: ['**/*.js', '**/*.jsx']
  }
];

/**
 * LSPManager - Language Server Protocol manager
 */
export class LSPManager {
  private projectRoot: string;
  private servers: Map<string, {
    process: ChildProcess;
    connection: MessageConnection;
    capabilities: LSPCapabilities;
  }> = new Map();
  private diagnosticsCache: Map<string, LSPDiagnostic[]> = new Map();
  private openDocuments: Set<string> = new Set();

  constructor(projectRoot: string, _config: LSPConfig) {
    this.projectRoot = projectRoot;
  }

  /**
   * Initialize LSP servers
   */
  async initialize(): Promise<void> {
    // Start TypeScript language server by default
    await this.startServer('typescript');
  }

  /**
   * Start a language server
   */
  async startServer(languageId: string): Promise<void> {
    if (this.servers.has(languageId)) {
      return; // Already running
    }

    const serverConfig = DEFAULT_SERVERS.find(s => s.languageId === languageId);
    if (!serverConfig) {
      throw new Error(`No server configuration for language: ${languageId}`);
    }

    try {
      // Spawn the language server process
      const serverProcess = spawn(serverConfig.command, serverConfig.args, {
        cwd: this.projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32'
      });

      if (!serverProcess.stdin || !serverProcess.stdout) {
        throw new Error('Failed to create server process streams');
      }

      // Create message connection
      const connection = createMessageConnection(
        new StreamMessageReader(serverProcess.stdout),
        new StreamMessageWriter(serverProcess.stdin)
      );

      // Handle diagnostics
      connection.onNotification(PublishDiagnosticsNotification.type, params => {
        const diagnostics = params.diagnostics.map(d => ({
          range: d.range,
          severity: this.mapSeverity(d.severity ?? 1),
          code: d.code?.toString(),
          source: d.source,
          message: d.message,
          relatedInformation: d.relatedInformation?.map(ri => ({
            location: {
              uri: ri.location.uri,
              range: ri.location.range
            },
            message: ri.message
          }))
        }));
        this.diagnosticsCache.set(this.uriToPath(params.uri), diagnostics);
      });

      // Start listening
      connection.listen();

      // Initialize the server
      const initParams: InitializeParams = {
        processId: process.pid,
        rootUri: this.pathToUri(this.projectRoot),
        capabilities: {
          textDocument: {
            synchronization: {
              dynamicRegistration: false,
              willSave: false,
              willSaveWaitUntil: false,
              didSave: true
            },
            definition: { dynamicRegistration: false },
            references: { dynamicRegistration: false },
            documentSymbol: { dynamicRegistration: false },
            publishDiagnostics: { relatedInformation: true }
          },
          workspace: {
            symbol: { dynamicRegistration: false },
            workspaceFolders: true
          }
        },
        workspaceFolders: [
          {
            uri: this.pathToUri(this.projectRoot),
            name: path.basename(this.projectRoot)
          }
        ]
      };

      const initResult = await connection.sendRequest(InitializeRequest.type, initParams);

      // Extract capabilities
      const capabilities: LSPCapabilities = {
        definitionProvider: !!initResult.capabilities.definitionProvider,
        referencesProvider: !!initResult.capabilities.referencesProvider,
        documentSymbolProvider: !!initResult.capabilities.documentSymbolProvider,
        workspaceSymbolProvider: !!initResult.capabilities.workspaceSymbolProvider,
        diagnosticProvider: !!initResult.capabilities.diagnosticProvider,
        hoverProvider: !!initResult.capabilities.hoverProvider,
        completionProvider: !!initResult.capabilities.completionProvider,
        renameProvider: !!initResult.capabilities.renameProvider
      };

      // Send initialized notification
      connection.sendNotification(InitializedNotification.type, {});

      this.servers.set(languageId, {
        process: serverProcess,
        connection,
        capabilities
      });

    } catch (error) {
      throw new Error(`Failed to start ${languageId} server: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Stop a language server
   */
  async stopServer(languageId: string): Promise<void> {
    const server = this.servers.get(languageId);
    if (!server) return;

    try {
      server.connection.dispose();
      server.process.kill();
    } catch {
      // Ignore errors during shutdown
    }

    this.servers.delete(languageId);
  }

  /**
   * Shutdown all servers
   */
  async shutdown(): Promise<void> {
    for (const languageId of this.servers.keys()) {
      await this.stopServer(languageId);
    }
  }

  /**
   * Get server status
   */
  getStatus(): LSPServerStatus[] {
    const statuses: LSPServerStatus[] = [];

    for (const [languageId, server] of this.servers) {
      statuses.push({
        languageId,
        running: true,
        capabilities: server.capabilities
      });
    }

    return statuses;
  }

  /**
   * Go to definition
   */
  async gotoDefinition(file: string, line: number, column: number): Promise<DefinitionResult | null> {
    const server = this.getServerForFile(file);
    if (!server) {
      throw new Error('No language server available for this file');
    }

    await this.ensureDocumentOpen(file);

    const params = {
      textDocument: TextDocumentIdentifier.create(this.pathToUri(file)),
      position: Position.create(line - 1, column - 1) // Convert to 0-indexed
    };

    const result = await server.connection.sendRequest(DefinitionRequest.type, params);

    if (!result) {
      return null;
    }

    // Handle different result types
    let location: { uri: string; range: { start: { line: number; character: number } } };
    if (Array.isArray(result)) {
      if (result.length === 0) return null;
      location = result[0] as typeof location;
    } else {
      location = result as typeof location;
    }

    const targetFile = this.uriToPath(location.uri);
    const targetLine = location.range.start.line + 1;
    const targetColumn = location.range.start.character + 1;

    // Try to get preview
    let preview: string | undefined;
    try {
      const content = await fs.readFile(targetFile, 'utf-8');
      const lines = content.split('\n');
      preview = lines[targetLine - 1]?.trim();
    } catch {
      // Preview unavailable
    }

    return {
      file: targetFile,
      line: targetLine,
      column: targetColumn,
      preview
    };
  }

  /**
   * Find all references
   */
  async findReferences(file: string, line: number, column: number): Promise<ReferencesResult> {
    const server = this.getServerForFile(file);
    if (!server) {
      throw new Error('No language server available for this file');
    }

    await this.ensureDocumentOpen(file);

    const params = {
      textDocument: TextDocumentIdentifier.create(this.pathToUri(file)),
      position: Position.create(line - 1, column - 1),
      context: { includeDeclaration: true }
    };

    const result = await server.connection.sendRequest(ReferencesRequest.type, params);

    if (!result || result.length === 0) {
      return {
        symbol: 'unknown',
        totalCount: 0,
        references: []
      };
    }

    // Get symbol name from first reference
    let symbolName = 'unknown';
    try {
      const firstRef = result[0];
      const content = await fs.readFile(this.uriToPath(firstRef.uri), 'utf-8');
      const lines = content.split('\n');
      const refLine = lines[firstRef.range.start.line];
      symbolName = refLine?.substring(
        firstRef.range.start.character,
        firstRef.range.end.character
      ) ?? 'unknown';
    } catch {
      // Symbol extraction failed
    }

    const references: ReferencesResult['references'] = [];

    for (const ref of result) {
      const refFile = this.uriToPath(ref.uri);
      const refLine = ref.range.start.line + 1;
      const refColumn = ref.range.start.character + 1;

      let preview = '';
      try {
        const content = await fs.readFile(refFile, 'utf-8');
        const lines = content.split('\n');
        preview = lines[refLine - 1]?.trim() ?? '';
      } catch {
        // Preview unavailable
      }

      references.push({
        file: refFile,
        line: refLine,
        column: refColumn,
        preview,
        isDefinition: refLine === line && refColumn === column && refFile === file
      });
    }

    return {
      symbol: symbolName,
      totalCount: references.length,
      references
    };
  }

  /**
   * Get diagnostics
   */
  async getDiagnostics(file?: string): Promise<DiagnosticsResult[]> {
    const results: DiagnosticsResult[] = [];

    if (file) {
      // Get diagnostics for specific file
      await this.ensureDocumentOpen(file);
      const diagnostics = this.diagnosticsCache.get(file) ?? [];
      results.push({
        file,
        diagnostics,
        errorCount: diagnostics.filter(d => d.severity === 'error').length,
        warningCount: diagnostics.filter(d => d.severity === 'warning').length
      });
    } else {
      // Get all cached diagnostics
      for (const [filePath, diagnostics] of this.diagnosticsCache) {
        results.push({
          file: filePath,
          diagnostics,
          errorCount: diagnostics.filter(d => d.severity === 'error').length,
          warningCount: diagnostics.filter(d => d.severity === 'warning').length
        });
      }
    }

    return results;
  }

  /**
   * Search for symbols
   */
  async searchSymbols(query: string): Promise<SymbolSearchResult> {
    // Use first available server
    const server = this.servers.values().next().value;
    if (!server) {
      throw new Error('No language server available');
    }

    const params = { query };
    const result = await server.connection.sendRequest(WorkspaceSymbolRequest.type, params);

    if (!result) {
      return { symbols: [], totalCount: 0 };
    }

    const symbols = result.map(s => ({
      name: s.name,
      kind: this.symbolKindToString(s.kind),
      location: {
        uri: s.location.uri,
        range: 'range' in s.location ? s.location.range : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
      },
      containerName: s.containerName
    }));

    return {
      symbols,
      totalCount: symbols.length
    };
  }

  /**
   * Get context at a location (for error analysis)
   */
  async getContext(file: string, line: number): Promise<{
    code: string;
    symbols: Array<{ name: string; kind: string }>;
  }> {
    const server = this.getServerForFile(file);

    // Get surrounding code
    let code = '';
    try {
      const content = await fs.readFile(file, 'utf-8');
      const lines = content.split('\n');
      const start = Math.max(0, line - 3);
      const end = Math.min(lines.length, line + 3);
      code = lines.slice(start, end).join('\n');
    } catch {
      // Code unavailable
    }

    // Get document symbols
    let symbols: Array<{ name: string; kind: string }> = [];
    if (server) {
      try {
        await this.ensureDocumentOpen(file);
        const params = {
          textDocument: TextDocumentIdentifier.create(this.pathToUri(file))
        };
        const result = await server.connection.sendRequest(DocumentSymbolRequest.type, params);
        if (result) {
          symbols = result.map(s => ({
            name: 'name' in s ? s.name : 'unknown',
            kind: 'kind' in s ? this.symbolKindToString(s.kind) : 'unknown'
          }));
        }
      } catch {
        // Symbols unavailable
      }
    }

    return { code, symbols };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private getServerForFile(file: string): typeof this.servers extends Map<string, infer V> ? V : never {
    const ext = path.extname(file);

    if (['.ts', '.tsx'].includes(ext)) {
      return this.servers.get('typescript') as ReturnType<typeof this.getServerForFile>;
    }
    if (['.js', '.jsx'].includes(ext)) {
      return (this.servers.get('javascript') ?? this.servers.get('typescript')) as ReturnType<typeof this.getServerForFile>;
    }

    // Return first available server
    return this.servers.values().next().value as ReturnType<typeof this.getServerForFile>;
  }

  private async ensureDocumentOpen(file: string): Promise<void> {
    if (this.openDocuments.has(file)) return;

    const server = this.getServerForFile(file);
    if (!server) return;

    try {
      const content = await fs.readFile(file, 'utf-8');
      const languageId = this.getLanguageId(file);

      const textDocument: TextDocumentItem = {
        uri: this.pathToUri(file),
        languageId,
        version: 1,
        text: content
      };

      server.connection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument
      });

      this.openDocuments.add(file);
    } catch {
      // Document open failed
    }
  }

  private getLanguageId(file: string): string {
    const ext = path.extname(file);
    switch (ext) {
      case '.ts': return 'typescript';
      case '.tsx': return 'typescriptreact';
      case '.js': return 'javascript';
      case '.jsx': return 'javascriptreact';
      case '.json': return 'json';
      default: return 'plaintext';
    }
  }

  private pathToUri(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (normalizedPath.startsWith('/')) {
      return `file://${normalizedPath}`;
    }
    // Windows path
    return `file:///${normalizedPath}`;
  }

  private uriToPath(uri: string): string {
    let filePath = uri.replace('file://', '');
    // Handle Windows paths
    if (filePath.startsWith('/') && filePath.charAt(2) === ':') {
      filePath = filePath.substring(1);
    }
    return filePath.replace(/\//g, path.sep);
  }

  private mapSeverity(severity: number): 'error' | 'warning' | 'info' | 'hint' {
    switch (severity) {
      case 1: return 'error';
      case 2: return 'warning';
      case 3: return 'info';
      case 4: return 'hint';
      default: return 'info';
    }
  }

  private symbolKindToString(kind: number): string {
    const kinds: Record<number, string> = {
      1: 'File',
      2: 'Module',
      3: 'Namespace',
      4: 'Package',
      5: 'Class',
      6: 'Method',
      7: 'Property',
      8: 'Field',
      9: 'Constructor',
      10: 'Enum',
      11: 'Interface',
      12: 'Function',
      13: 'Variable',
      14: 'Constant',
      15: 'String',
      16: 'Number',
      17: 'Boolean',
      18: 'Array',
      19: 'Object',
      20: 'Key',
      21: 'Null',
      22: 'EnumMember',
      23: 'Struct',
      24: 'Event',
      25: 'Operator',
      26: 'TypeParameter'
    };
    return kinds[kind] ?? 'Unknown';
  }
}

export default LSPManager;
