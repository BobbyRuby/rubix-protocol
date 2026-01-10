/**
 * Doc Mining Types
 *
 * Type definitions specific to documentation mining.
 */

export interface CachedDoc {
  url: string;
  title: string;
  content: string;
  markdown: string;
  fetchedAt: Date;
  expiresAt: Date;
}

export interface DocParseOptions {
  /** Extract code examples */
  extractCode?: boolean;
  /** Include images */
  includeImages?: boolean;
  /** Maximum content length */
  maxLength?: number;
}

export interface DocSource {
  name: string;
  baseUrl: string;
  searchPattern?: string;
}

export interface CodeExample {
  language: string;
  code: string;
  description?: string;
}
