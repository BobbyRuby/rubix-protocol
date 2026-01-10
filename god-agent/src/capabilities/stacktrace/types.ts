/**
 * Stack Trace Types
 *
 * Type definitions specific to stack trace parsing.
 */

export interface RawStackFrame {
  raw: string;
  functionName?: string;
  methodName?: string;
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
  typeName?: string;
  isNative?: boolean;
  isConstructor?: boolean;
  isEval?: boolean;
}

export interface SourceMapInfo {
  file: string;
  sourceRoot: string;
  sources: string[];
  mappings: string;
}

export interface MappedLocation {
  originalFile: string;
  originalLine: number;
  originalColumn: number;
  generatedFile: string;
  generatedLine: number;
  generatedColumn: number;
}

export interface StackParseOptions {
  /** Include source context */
  includeContext?: boolean;
  /** Number of context lines */
  contextLines?: number;
  /** Apply source maps */
  applySourceMaps?: boolean;
}
