/**
 * ASTManager
 *
 * Abstract Syntax Tree manipulation for safe code transformations.
 * Uses Babel for parsing, traversing, and code generation.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as parser from '@babel/parser';
import * as babelTraverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import * as babelGenerator from '@babel/generator';
import * as t from '@babel/types';

// Handle default export compatibility for ESM/CJS interop
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const traverse: any = (babelTraverse as any).default ?? babelTraverse;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const generate: any = (babelGenerator as any).default ?? babelGenerator;

import type { ASTConfig } from '../types.js';
import type {
  ASTParseResult,
  ASTQueryResult,
  RefactorResult,
  RefactorOperation,
  ASTNode
} from '../types.js';
import type { BabelAST, SymbolInfo } from './types.js';

/**
 * ASTManager - AST manipulation operations
 */
export class ASTManager {
  private projectRoot: string;
  private astCache: Map<string, { ast: BabelAST; mtime: number }> = new Map();

  constructor(projectRoot: string, _config: ASTConfig) {
    this.projectRoot = projectRoot;
  }

  /**
   * Parse a file into an AST
   */
  async parse(file: string): Promise<ASTParseResult> {
    const absolutePath = path.isAbsolute(file) ? file : path.join(this.projectRoot, file);
    const relativePath = path.relative(this.projectRoot, absolutePath);

    try {
      const content = await fs.readFile(absolutePath, 'utf-8');
      const stat = await fs.stat(absolutePath);

      // Check cache
      const cached = this.astCache.get(absolutePath);
      if (cached && cached.mtime === stat.mtimeMs) {
        return {
          file: relativePath,
          ast: this.simplifyNode(cached.ast.program) as ASTNode,
          errors: []
        };
      }

      // Parse the file
      const ast = parser.parse(content, {
        sourceType: 'module',
        plugins: this.getParserPlugins(file),
        errorRecovery: true
      });

      // Cache the result
      this.astCache.set(absolutePath, { ast, mtime: stat.mtimeMs });

      // Extract errors
      const errors = (ast.errors ?? []).map(err => ({
        message: err.message,
        line: err.loc?.line ?? 0,
        column: err.loc?.column ?? 0
      }));

      return {
        file: relativePath,
        ast: this.simplifyNode(ast.program) as ASTNode,
        errors
      };
    } catch (error) {
      return {
        file: relativePath,
        ast: { type: 'Error', start: 0, end: 0, loc: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } },
        errors: [{
          message: error instanceof Error ? error.message : String(error),
          line: 0,
          column: 0
        }]
      };
    }
  }

  /**
   * Query AST for specific node types
   */
  async query(file: string, nodeType: string): Promise<ASTQueryResult> {
    const absolutePath = path.isAbsolute(file) ? file : path.join(this.projectRoot, file);
    const relativePath = path.relative(this.projectRoot, absolutePath);

    const matches: ASTQueryResult['matches'] = [];

    try {
      const content = await fs.readFile(absolutePath, 'utf-8');
      const ast = parser.parse(content, {
        sourceType: 'module',
        plugins: this.getParserPlugins(file),
        errorRecovery: true
      });

      traverse(ast, {
        enter(nodePath: NodePath) {
          if (nodePath.node.type === nodeType) {
            const node = nodePath.node;
            const start = node.start ?? 0;
            const end = node.end ?? 0;

            matches.push({
              node: {
                type: node.type,
                start,
                end,
                loc: node.loc ?? { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
              },
              path: nodePath.getPathLocation(),
              code: content.substring(start, end)
            });
          }
        }
      });
    } catch (error) {
      // Return empty matches on parse error
    }

    return {
      file: relativePath,
      nodeType,
      matches
    };
  }

  /**
   * Perform a refactoring operation
   */
  async refactor(operation: RefactorOperation): Promise<RefactorResult> {
    try {
      switch (operation.type) {
        case 'rename':
          return await this.performRename(operation.target, operation.newValue!, operation.scope);

        case 'extract':
          return await this.performExtract(operation.target, operation.newValue!);

        case 'inline':
          return await this.performInline(operation.target);

        case 'move':
          return await this.performMove(operation.target, operation.newValue!);

        default:
          return {
            operation,
            changes: [],
            affectedFiles: 0,
            success: false,
            error: `Unknown operation type: ${operation.type}`
          };
      }
    } catch (error) {
      return {
        operation,
        changes: [],
        affectedFiles: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get all symbols in a file
   */
  async getSymbols(file: string): Promise<SymbolInfo[]> {
    const absolutePath = path.isAbsolute(file) ? file : path.join(this.projectRoot, file);
    const symbols: SymbolInfo[] = [];

    try {
      const content = await fs.readFile(absolutePath, 'utf-8');
      const ast = parser.parse(content, {
        sourceType: 'module',
        plugins: this.getParserPlugins(file),
        errorRecovery: true
      });

      traverse(ast, {
        FunctionDeclaration(nodePath: NodePath<t.FunctionDeclaration>) {
          if (nodePath.node.id) {
            symbols.push({
              name: nodePath.node.id.name,
              kind: 'function',
              location: {
                file,
                line: nodePath.node.loc?.start.line ?? 0,
                column: nodePath.node.loc?.start.column ?? 0
              },
              scope: nodePath.scope.parent ? 'local' : 'module',
              exported: t.isExportDeclaration(nodePath.parentPath.node)
            });
          }
        },
        ClassDeclaration(nodePath: NodePath<t.ClassDeclaration>) {
          if (nodePath.node.id) {
            symbols.push({
              name: nodePath.node.id.name,
              kind: 'class',
              location: {
                file,
                line: nodePath.node.loc?.start.line ?? 0,
                column: nodePath.node.loc?.start.column ?? 0
              },
              scope: 'module',
              exported: t.isExportDeclaration(nodePath.parentPath.node)
            });
          }
        },
        VariableDeclarator(nodePath: NodePath<t.VariableDeclarator>) {
          if (t.isIdentifier(nodePath.node.id)) {
            symbols.push({
              name: nodePath.node.id.name,
              kind: 'variable',
              location: {
                file,
                line: nodePath.node.loc?.start.line ?? 0,
                column: nodePath.node.loc?.start.column ?? 0
              },
              scope: nodePath.scope.parent?.parent ? 'local' : 'module',
              exported: t.isExportDeclaration(nodePath.parentPath.parentPath?.node)
            });
          }
        },
        ImportDeclaration(nodePath: NodePath<t.ImportDeclaration>) {
          for (const specifier of nodePath.node.specifiers) {
            symbols.push({
              name: specifier.local.name,
              kind: 'import',
              location: {
                file,
                line: specifier.loc?.start.line ?? 0,
                column: specifier.loc?.start.column ?? 0
              },
              scope: 'module',
              exported: false
            });
          }
        }
      });
    } catch {
      // Return empty on error
    }

    return symbols;
  }

  /**
   * Find all usages of a symbol
   */
  async findUsages(file: string, symbolName: string): Promise<Array<{
    file: string;
    line: number;
    column: number;
    usage: 'declaration' | 'reference' | 'assignment';
  }>> {
    const usages: Array<{
      file: string;
      line: number;
      column: number;
      usage: 'declaration' | 'reference' | 'assignment';
    }> = [];

    const absolutePath = path.isAbsolute(file) ? file : path.join(this.projectRoot, file);

    try {
      const content = await fs.readFile(absolutePath, 'utf-8');
      const ast = parser.parse(content, {
        sourceType: 'module',
        plugins: this.getParserPlugins(file),
        errorRecovery: true
      });

      traverse(ast, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Identifier(nodePath: any) {
          if (nodePath.node.name !== symbolName) return;

          let usage: 'declaration' | 'reference' | 'assignment' = 'reference';

          if (nodePath.isBindingIdentifier()) {
            usage = 'declaration';
          } else if (t.isAssignmentExpression(nodePath.parent) && nodePath.parent.left === nodePath.node) {
            usage = 'assignment';
          }

          usages.push({
            file,
            line: nodePath.node.loc?.start.line ?? 0,
            column: nodePath.node.loc?.start.column ?? 0,
            usage
          });
        }
      });
    } catch {
      // Return empty on error
    }

    return usages;
  }

  // ===========================================================================
  // Refactoring implementations
  // ===========================================================================

  private async performRename(
    target: string,
    newName: string,
    _scope?: string
  ): Promise<RefactorResult> {
    const changes: RefactorResult['changes'] = [];
    const [file, symbolName] = target.split(':');

    if (!file || !symbolName) {
      return {
        operation: { type: 'rename', target, newValue: newName },
        changes: [],
        affectedFiles: 0,
        success: false,
        error: 'Invalid target format. Use "file:symbolName"'
      };
    }

    const absolutePath = path.isAbsolute(file) ? file : path.join(this.projectRoot, file);

    try {
      const content = await fs.readFile(absolutePath, 'utf-8');
      const ast = parser.parse(content, {
        sourceType: 'module',
        plugins: this.getParserPlugins(file),
        errorRecovery: true
      });

      // Rename all occurrences
      traverse(ast, {
        Identifier(nodePath: NodePath<t.Identifier>) {
          if (nodePath.node.name === symbolName) {
            nodePath.node.name = newName;
          }
        }
      });

      // Generate new code
      const result = generate(ast, {
        retainLines: true,
        compact: false
      });

      changes.push({
        file,
        oldContent: content,
        newContent: result.code,
        diffPreview: this.createDiffPreview(content, result.code)
      });

      return {
        operation: { type: 'rename', target, newValue: newName },
        changes,
        affectedFiles: 1,
        success: true
      };
    } catch (error) {
      return {
        operation: { type: 'rename', target, newValue: newName },
        changes: [],
        affectedFiles: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async performExtract(target: string, newName: string): Promise<RefactorResult> {
    // TODO: Implement function/variable extraction
    return {
      operation: { type: 'extract', target, newValue: newName },
      changes: [],
      affectedFiles: 0,
      success: false,
      error: 'Extract refactoring not yet implemented'
    };
  }

  private async performInline(target: string): Promise<RefactorResult> {
    // TODO: Implement function/variable inlining
    return {
      operation: { type: 'inline', target },
      changes: [],
      affectedFiles: 0,
      success: false,
      error: 'Inline refactoring not yet implemented'
    };
  }

  private async performMove(target: string, destination: string): Promise<RefactorResult> {
    // TODO: Implement symbol moving
    return {
      operation: { type: 'move', target, newValue: destination },
      changes: [],
      affectedFiles: 0,
      success: false,
      error: 'Move refactoring not yet implemented'
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private getParserPlugins(file: string): parser.ParserPlugin[] {
    const ext = path.extname(file);
    const plugins: parser.ParserPlugin[] = [
      'decorators-legacy',
      'classProperties',
      'classPrivateProperties',
      'classPrivateMethods',
      'exportDefaultFrom',
      'exportNamespaceFrom',
      'dynamicImport',
      'nullishCoalescingOperator',
      'optionalChaining',
      'objectRestSpread'
    ];

    if (ext === '.ts' || ext === '.tsx') {
      plugins.push('typescript');
    }

    if (ext === '.tsx' || ext === '.jsx') {
      plugins.push('jsx');
    }

    return plugins;
  }

  private simplifyNode(node: t.Node): ASTNode {
    const simplified: ASTNode = {
      type: node.type,
      start: node.start ?? 0,
      end: node.end ?? 0,
      loc: node.loc ?? { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
    };

    // Add key properties based on node type
    if (t.isIdentifier(node)) {
      simplified.name = node.name;
    }
    if (t.isLiteral(node) && 'value' in node) {
      simplified.value = node.value;
    }

    return simplified;
  }

  private createDiffPreview(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const diff: string[] = [];

    const maxLines = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLines; i++) {
      if (oldLines[i] !== newLines[i]) {
        if (oldLines[i]) diff.push(`- ${oldLines[i]}`);
        if (newLines[i]) diff.push(`+ ${newLines[i]}`);
      }
    }

    return diff.slice(0, 20).join('\n') + (diff.length > 20 ? '\n...' : '');
  }
}

export default ASTManager;
