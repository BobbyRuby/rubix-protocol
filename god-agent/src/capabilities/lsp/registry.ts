/**
 * LSP Language Server Registry
 *
 * Centralized configuration for all supported language servers.
 * Supports 10 languages with pluggable architecture.
 */

export interface LanguageServerEntry {
  name: string;
  languageId: string;
  command: string;
  windowsCommand?: string;
  args: string[];
  extensions: string[];
  patterns: string[];
  npmPackage?: string;
  installMethods: {
    npm?: string;
    pip?: string;
    cargo?: string;
    go?: string;
    rustup?: string;
    manual?: string;
  };
  initializationOptions?: Record<string, unknown>;
}

export const LANGUAGE_SERVER_REGISTRY: Record<string, LanguageServerEntry> = {
  typescript: {
    name: 'TypeScript Language Server',
    languageId: 'typescript',
    command: 'typescript-language-server',
    windowsCommand: 'typescript-language-server.cmd',
    args: ['--stdio'],
    extensions: ['ts', 'tsx'],
    patterns: ['**/*.ts', '**/*.tsx'],
    npmPackage: 'typescript-language-server',
    installMethods: {
      npm: 'npm install -g typescript-language-server typescript'
    }
  },

  javascript: {
    name: 'JavaScript Language Server',
    languageId: 'javascript',
    command: 'typescript-language-server',
    windowsCommand: 'typescript-language-server.cmd',
    args: ['--stdio'],
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    patterns: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
    npmPackage: 'typescript-language-server',
    installMethods: {
      npm: 'npm install -g typescript-language-server typescript'
    }
  },

  php: {
    name: 'Intelephense (PHP)',
    languageId: 'php',
    command: 'intelephense',
    windowsCommand: 'intelephense.cmd',
    args: ['--stdio'],
    extensions: ['php', 'phtml'],
    patterns: ['**/*.php', '**/*.phtml'],
    npmPackage: 'intelephense',
    installMethods: {
      npm: 'npm install -g intelephense'
    },
    initializationOptions: {
      storagePath: '/tmp/intelephense',
      clearCache: false
    }
  },

  css: {
    name: 'CSS Language Server',
    languageId: 'css',
    command: 'vscode-css-language-server',
    windowsCommand: 'vscode-css-language-server.cmd',
    args: ['--stdio'],
    extensions: ['css', 'scss', 'less'],
    patterns: ['**/*.css', '**/*.scss', '**/*.less'],
    npmPackage: 'vscode-langservers-extracted',
    installMethods: {
      npm: 'npm install -g vscode-langservers-extracted'
    }
  },

  html: {
    name: 'HTML Language Server',
    languageId: 'html',
    command: 'vscode-html-language-server',
    windowsCommand: 'vscode-html-language-server.cmd',
    args: ['--stdio'],
    extensions: ['html', 'htm'],
    patterns: ['**/*.html', '**/*.htm'],
    npmPackage: 'vscode-langservers-extracted',
    installMethods: {
      npm: 'npm install -g vscode-langservers-extracted'
    }
  },

  sql: {
    name: 'SQL Language Server',
    languageId: 'sql',
    command: 'sql-language-server',
    windowsCommand: 'sql-language-server.cmd',
    args: ['up', '--method', 'stdio'],
    extensions: ['sql'],
    patterns: ['**/*.sql'],
    npmPackage: 'sql-language-server',
    installMethods: {
      npm: 'npm install -g sql-language-server'
    }
  },

  java: {
    name: 'Eclipse JDT Language Server',
    languageId: 'java',
    command: 'jdtls',
    args: [],
    extensions: ['java'],
    patterns: ['**/*.java'],
    installMethods: {
      manual: 'Download from https://github.com/eclipse-jdtls/eclipse.jdt.ls and add to PATH'
    },
    initializationOptions: {
      bundles: [],
      workspaceFolders: []
    }
  },

  python: {
    name: 'Pyright Language Server',
    languageId: 'python',
    command: 'pyright-langserver',
    windowsCommand: 'pyright-langserver.cmd',
    args: ['--stdio'],
    extensions: ['py', 'pyi'],
    patterns: ['**/*.py', '**/*.pyi'],
    npmPackage: 'pyright',
    installMethods: {
      npm: 'npm install -g pyright',
      pip: 'pip install pyright'
    },
    initializationOptions: {
      python: {
        analysis: {
          autoSearchPaths: true,
          useLibraryCodeForTypes: true
        }
      }
    }
  },

  go: {
    name: 'gopls (Go Language Server)',
    languageId: 'go',
    command: 'gopls',
    args: ['serve'],
    extensions: ['go'],
    patterns: ['**/*.go'],
    installMethods: {
      go: 'go install golang.org/x/tools/gopls@latest'
    },
    initializationOptions: {
      usePlaceholders: true,
      completeUnimported: true
    }
  },

  rust: {
    name: 'rust-analyzer',
    languageId: 'rust',
    command: 'rust-analyzer',
    args: [],
    extensions: ['rs'],
    patterns: ['**/*.rs'],
    installMethods: {
      rustup: 'rustup component add rust-analyzer',
      manual: 'Download from https://github.com/rust-lang/rust-analyzer/releases'
    }
  }
};

/**
 * Map file extensions to LSP language IDs
 */
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  // TypeScript
  ts: 'typescript',
  tsx: 'typescriptreact',
  // JavaScript
  js: 'javascript',
  jsx: 'javascriptreact',
  mjs: 'javascript',
  cjs: 'javascript',
  // PHP
  php: 'php',
  phtml: 'php',
  // CSS
  css: 'css',
  scss: 'scss',
  less: 'less',
  // HTML
  html: 'html',
  htm: 'html',
  // SQL
  sql: 'sql',
  // Java
  java: 'java',
  // Python
  py: 'python',
  pyi: 'python',
  // Go
  go: 'go',
  // Rust
  rs: 'rust',
  // Other common types
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  xml: 'xml'
};

/**
 * Map file extensions to server keys (which server handles this extension)
 */
export const EXTENSION_TO_SERVER: Record<string, string> = {
  // TypeScript
  ts: 'typescript',
  tsx: 'typescript',
  // JavaScript
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  // PHP
  php: 'php',
  phtml: 'php',
  // CSS
  css: 'css',
  scss: 'css',
  less: 'css',
  // HTML
  html: 'html',
  htm: 'html',
  // SQL
  sql: 'sql',
  // Java
  java: 'java',
  // Python
  py: 'python',
  pyi: 'python',
  // Go
  go: 'go',
  // Rust
  rs: 'rust'
};

/**
 * Get list of all supported language IDs
 */
export function getSupportedLanguages(): string[] {
  return Object.keys(LANGUAGE_SERVER_REGISTRY);
}

/**
 * Get language server entry by language ID
 */
export function getLanguageEntry(languageId: string): LanguageServerEntry | undefined {
  return LANGUAGE_SERVER_REGISTRY[languageId];
}

/**
 * Get the server key for a file extension
 */
export function getServerForExtension(ext: string): string | undefined {
  const normalized = ext.startsWith('.') ? ext.slice(1) : ext;
  return EXTENSION_TO_SERVER[normalized];
}

/**
 * Get the LSP language ID for a file extension
 */
export function getLanguageIdForExtension(ext: string): string {
  const normalized = ext.startsWith('.') ? ext.slice(1) : ext;
  return EXTENSION_TO_LANGUAGE[normalized] ?? 'plaintext';
}

/**
 * Format install instructions for display
 */
export function formatInstallInstructions(entry: LanguageServerEntry): string {
  const methods = entry.installMethods;
  const lines: string[] = [];

  if (methods.npm) lines.push(`npm: ${methods.npm}`);
  if (methods.pip) lines.push(`pip: ${methods.pip}`);
  if (methods.go) lines.push(`go: ${methods.go}`);
  if (methods.cargo) lines.push(`cargo: ${methods.cargo}`);
  if (methods.rustup) lines.push(`rustup: ${methods.rustup}`);
  if (methods.manual) lines.push(`manual: ${methods.manual}`);

  return lines.length > 0 ? lines.join('\n') : 'No installation instructions available';
}
