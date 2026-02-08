/**
 * AST Types
 *
 * Type definitions specific to AST manipulation.
 */

import type { ParseResult } from '@babel/parser';
import type { File } from '@babel/types';

export type BabelAST = ParseResult<File>;

export interface ASTVisitorOptions {
  /** Node types to visit */
  nodeTypes?: string[];
  /** Maximum depth to traverse */
  maxDepth?: number;
  /** Skip node_modules */
  skipExternal?: boolean;
}

export interface ASTTransformOptions {
  /** Preserve formatting */
  preserveFormat?: boolean;
  /** Generate source maps */
  sourceMaps?: boolean;
  /** Dry run (don't write changes) */
  dryRun?: boolean;
}

export interface CodeLocation {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface SymbolInfo {
  name: string;
  kind: 'function' | 'class' | 'variable' | 'import' | 'export' | 'interface' | 'type';
  location: CodeLocation;
  scope: 'global' | 'module' | 'local';
  exported: boolean;
}

export interface RefactorPreview {
  file: string;
  before: string;
  after: string;
  changes: number;
}
