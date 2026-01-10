/**
 * StackParser
 *
 * Stack trace parsing for intelligent error understanding.
 * Uses stack-utils for parsing and source-map for mapping.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { SourceMapConsumer, type RawSourceMap } from 'source-map';

import type { StackTraceConfig } from '../types.js';
import type {
  ParsedStackTrace,
  ParsedStackFrame,
  StackContext
} from '../types.js';
import type { RawStackFrame, StackParseOptions, MappedLocation } from './types.js';

/**
 * StackParser - Stack trace parsing operations
 */
export class StackParser {
  private projectRoot: string;
  private sourceMapCache: Map<string, SourceMapConsumer> = new Map();

  constructor(projectRoot: string, _config: StackTraceConfig) {
    this.projectRoot = projectRoot;
  }

  /**
   * Parse an error or stack string
   */
  async parse(error: Error | string, options?: StackParseOptions): Promise<ParsedStackTrace> {
    const stackString = typeof error === 'string' ? error : error.stack ?? '';
    const errorMessage = typeof error === 'string' ? '' : error.message;
    const errorName = typeof error === 'string' ? 'Error' : error.name;

    // Parse the stack
    const rawFrames = this.parseStackString(stackString);
    const frames: ParsedStackFrame[] = [];

    for (const raw of rawFrames) {
      let frame = this.rawToFrame(raw);

      // Apply source maps if available
      if (options?.applySourceMaps !== false && frame.file) {
        const mapped = await this.applySourceMap(frame.file, frame.line, frame.column);
        if (mapped) {
          frame = {
            ...frame,
            file: mapped.originalFile,
            line: mapped.originalLine,
            column: mapped.originalColumn,
            source: undefined // Will be fetched separately if needed
          };
        }
      }

      frames.push(frame);
    }

    return {
      message: errorMessage,
      name: errorName,
      frames,
      originalStack: stackString
    };
  }

  /**
   * Get context (surrounding code) for a stack frame
   */
  async getContext(file: string, line: number, contextLines: number = 5): Promise<StackContext> {
    const frame: ParsedStackFrame = {
      functionName: '',
      file,
      line,
      column: 0,
      isNative: false,
      isConstructor: false,
      isAsync: false
    };

    const surroundingCode: StackContext['surroundingCode'] = [];

    try {
      const absolutePath = path.isAbsolute(file)
        ? file
        : path.join(this.projectRoot, file);

      const content = await fs.readFile(absolutePath, 'utf-8');
      const lines = content.split('\n');

      const startLine = Math.max(0, line - contextLines - 1);
      const endLine = Math.min(lines.length, line + contextLines);

      for (let i = startLine; i < endLine; i++) {
        surroundingCode.push({
          line: i + 1,
          content: lines[i],
          isErrorLine: i + 1 === line
        });
      }
    } catch {
      // File read failed
    }

    return {
      frame,
      surroundingCode
    };
  }

  /**
   * Parse a stack string into raw frames
   */
  parseStackString(stack: string): RawStackFrame[] {
    const frames: RawStackFrame[] = [];
    const lines = stack.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip the error message line
      if (!trimmed.startsWith('at ') && !trimmed.match(/^\w+Error:/)) {
        continue;
      }

      if (trimmed.startsWith('at ')) {
        const frame = this.parseStackLine(trimmed);
        if (frame) {
          frames.push(frame);
        }
      }
    }

    return frames;
  }

  /**
   * Parse a single stack line
   */
  private parseStackLine(line: string): RawStackFrame | null {
    // Remove 'at ' prefix
    const content = line.replace(/^\s*at\s+/, '');

    // Patterns:
    // functionName (file:line:column)
    // file:line:column
    // eval at functionName (file:line:column), <anonymous>:line:column
    // new ClassName (file:line:column)
    // async functionName (file:line:column)

    // Check for async
    const isAsync = content.startsWith('async ');
    const withoutAsync = isAsync ? content.replace(/^async\s+/, '') : content;

    // Check for new (constructor)
    const isConstructor = withoutAsync.startsWith('new ');
    const withoutNew = isConstructor ? withoutAsync.replace(/^new\s+/, '') : withoutAsync;

    // Match patterns
    const patterns = [
      // functionName (file:line:column)
      /^(.+?)\s+\((.+?):(\d+):(\d+)\)$/,
      // file:line:column
      /^(.+?):(\d+):(\d+)$/,
      // functionName (file:line)
      /^(.+?)\s+\((.+?):(\d+)\)$/,
      // eval at ... , <anonymous>:line:column
      /^eval at .+?, <anonymous>:(\d+):(\d+)$/
    ];

    for (const pattern of patterns) {
      const match = withoutNew.match(pattern);
      if (match) {
        if (match.length === 5) {
          // functionName (file:line:column)
          return {
            raw: line,
            functionName: match[1],
            fileName: match[2],
            lineNumber: parseInt(match[3], 10),
            columnNumber: parseInt(match[4], 10),
            isConstructor,
            isNative: match[2].startsWith('node:') || match[2].includes('native'),
            isEval: false
          };
        } else if (match.length === 4 && !match[1].includes(':')) {
          // functionName (file:line)
          return {
            raw: line,
            functionName: match[1],
            fileName: match[2],
            lineNumber: parseInt(match[3], 10),
            isConstructor,
            isNative: match[2].startsWith('node:') || match[2].includes('native'),
            isEval: false
          };
        } else if (match.length === 4) {
          // file:line:column
          return {
            raw: line,
            fileName: match[1],
            lineNumber: parseInt(match[2], 10),
            columnNumber: parseInt(match[3], 10),
            isConstructor,
            isNative: match[1].startsWith('node:') || match[1].includes('native'),
            isEval: false
          };
        } else if (match.length === 3) {
          // eval
          return {
            raw: line,
            functionName: 'eval',
            lineNumber: parseInt(match[1], 10),
            columnNumber: parseInt(match[2], 10),
            isConstructor: false,
            isNative: false,
            isEval: true
          };
        }
      }
    }

    // Native functions
    if (content.includes('native')) {
      return {
        raw: line,
        functionName: content.replace(' [native code]', ''),
        isNative: true,
        isConstructor,
        isEval: false
      };
    }

    return null;
  }

  /**
   * Convert raw frame to parsed frame
   */
  private rawToFrame(raw: RawStackFrame): ParsedStackFrame {
    let file = raw.fileName ?? 'unknown';

    // Make path relative to project root
    if (path.isAbsolute(file)) {
      file = path.relative(this.projectRoot, file);
    }

    return {
      functionName: raw.functionName ?? raw.methodName ?? '(anonymous)',
      file,
      line: raw.lineNumber ?? 0,
      column: raw.columnNumber ?? 0,
      isNative: raw.isNative ?? false,
      isConstructor: raw.isConstructor ?? false,
      isAsync: false
    };
  }

  /**
   * Apply source map to get original location
   */
  private async applySourceMap(
    file: string,
    line: number,
    column: number
  ): Promise<MappedLocation | null> {
    try {
      // Find source map file
      const absolutePath = path.isAbsolute(file)
        ? file
        : path.join(this.projectRoot, file);

      const mapPath = absolutePath + '.map';

      // Check cache
      if (!this.sourceMapCache.has(mapPath)) {
        try {
          const mapContent = await fs.readFile(mapPath, 'utf-8');
          const rawMap = JSON.parse(mapContent) as RawSourceMap;
          const consumer = await new SourceMapConsumer(rawMap);
          this.sourceMapCache.set(mapPath, consumer);
        } catch {
          // No source map available
          return null;
        }
      }

      const consumer = this.sourceMapCache.get(mapPath)!;
      const originalPos = consumer.originalPositionFor({ line, column });

      if (originalPos.source) {
        return {
          originalFile: originalPos.source,
          originalLine: originalPos.line ?? line,
          originalColumn: originalPos.column ?? column,
          generatedFile: file,
          generatedLine: line,
          generatedColumn: column
        };
      }
    } catch {
      // Source map parsing failed
    }

    return null;
  }

  /**
   * Clean up source map consumers
   */
  async cleanup(): Promise<void> {
    for (const consumer of this.sourceMapCache.values()) {
      consumer.destroy();
    }
    this.sourceMapCache.clear();
  }

  /**
   * Get a clean, readable version of the stack
   */
  formatStack(parsed: ParsedStackTrace): string {
    const lines: string[] = [];

    lines.push(`${parsed.name}: ${parsed.message}`);

    for (const frame of parsed.frames) {
      if (frame.isNative) continue; // Skip native frames

      let line = '    at ';
      if (frame.functionName) {
        line += frame.functionName + ' ';
      }
      line += `(${frame.file}:${frame.line}:${frame.column})`;
      lines.push(line);
    }

    return lines.join('\n');
  }
}

export default StackParser;
