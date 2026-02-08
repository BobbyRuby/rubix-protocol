/**
 * Type declarations for modules without @types packages
 */

declare module 'madge' {
  interface MadgeResult {
    obj(): Record<string, string[]>;
    circular(): string[][];
    depends(id: string): string[];
    orphans(): string[];
    leaves(): string[];
    warnings(): { skipped: string[] };
    dot(): string;
    svg(): Promise<Buffer>;
    image(outputPath: string): Promise<string>;
  }

  interface MadgeConfig {
    baseDir?: string;
    includeNpm?: boolean;
    fileExtensions?: string[];
    excludeRegExp?: RegExp[];
    requireConfig?: string;
    webpackConfig?: string;
    tsConfig?: string;
    dependencyFilter?: (id: string) => boolean;
    detectiveOptions?: Record<string, unknown>;
  }

  function madge(path: string | string[], config?: MadgeConfig): Promise<MadgeResult>;

  export = madge;
}
