/**
 * PromptCompressor - Central prompt compression for entire system.
 * No NLP. No pleasantries. Pure tokens.
 */

export class PromptCompressor {
  /**
   * Compress any context object to key:value|key:value format
   */
  static ctx(obj: Record<string, unknown>): string {
    return Object.entries(obj)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}:${this.val(v)}`)
      .join('|');
  }

  /**
   * Compress value based on type
   */
  static val(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.slice(0, 5).join(',');
    if (typeof v === 'object') return JSON.stringify(v);
    if (typeof v === 'string') return v.slice(0, 200);
    return String(v);
  }

  /**
   * Compress stack trace to fn@file:line format
   */
  static stack(s: string): string {
    if (!s) return '';
    return s.split('\n')
      .slice(0, 5)
      .map(l => {
        const match = l.match(/at (\S+).*[/\\](\w+\.\w+):(\d+)/);
        return match ? `${match[1]}@${match[2]}:${match[3]}` : null;
      })
      .filter(Boolean)
      .join('|');
  }

  /**
   * Compress code by stripping comments and collapsing whitespace
   */
  static code(c: string): string {
    if (!c) return '';
    return c
      .replace(/\/\*[\s\S]*?\*\//g, '')  // block comments
      .replace(/\/\/.*/g, '')             // line comments
      .replace(/\s+/g, ' ')               // collapse whitespace
      .trim()
      .slice(0, 2000);                    // cap length
  }

  /**
   * Compress file list to basenames
   */
  static files(f: string[]): string {
    if (!f || !f.length) return '';
    return f.map(p => p.split(/[/\\]/).pop()).join(',');
  }

  /**
   * Compress error to type|message format
   */
  static err(e: Error | { type?: string; message: string } | string): string {
    if (typeof e === 'string') return e.slice(0, 200);
    if (e instanceof Error) return `${e.name}|${e.message.slice(0, 150)}`;
    return `${e.type || 'Error'}|${e.message.slice(0, 150)}`;
  }

  /**
   * Compress object to minimal JSON
   */
  static json(obj: unknown): string {
    return JSON.stringify(obj, null, 0);
  }

  /**
   * Compress array of items with limit
   */
  static list<T>(arr: T[], limit: number = 5, mapper?: (item: T) => string): string {
    const items = arr.slice(0, limit);
    if (mapper) return items.map(mapper).join(',');
    return items.map(i => String(i)).join(',');
  }
}

// Shorthand alias
export const PC = PromptCompressor;
