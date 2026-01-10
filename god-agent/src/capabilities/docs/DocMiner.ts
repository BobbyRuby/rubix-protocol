/**
 * DocMiner
 *
 * Documentation mining for fetching and parsing library documentation.
 * Uses cheerio for HTML parsing and turndown for markdown conversion.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as cheerio from 'cheerio';
import { Element } from 'domhandler';
import TurndownService from 'turndown';

import type { DocsConfig } from '../types.js';
import type {
  DocFetchResult,
  DocSearchResult,
  DocSection
} from '../types.js';
import type { CachedDoc, DocParseOptions } from './types.js';

/**
 * DocMiner - Documentation mining operations
 */
export class DocMiner {
  private config: DocsConfig;
  private cache: Map<string, CachedDoc> = new Map();
  private turndown: TurndownService;
  private cacheDir: string;

  constructor(projectRoot: string, config: DocsConfig) {
    this.config = config;
    this.cacheDir = config.cacheDir ?? path.join(projectRoot, '.doc-cache');

    // Initialize turndown for HTML to Markdown conversion
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    });

    // Add code block rule
    this.turndown.addRule('codeBlock', {
      filter: ['pre'],
      replacement: (content: string, node: unknown) => {
        // Extract language from code element if present
        const nodeObj = node as { querySelector?: (sel: string) => { className?: string } | null };
        const codeElement = nodeObj.querySelector?.('code');
        const language = codeElement?.className?.match(/language-(\w+)/)?.[1] ?? '';
        return `\n\`\`\`${language}\n${content}\n\`\`\`\n`;
      }
    });
  }

  /**
   * Fetch documentation from a URL
   */
  async fetch(url: string, _options?: DocParseOptions): Promise<DocFetchResult> {
    // Check cache first
    const cached = await this.getCached(url);
    if (cached) {
      return this.formatCachedResult(cached);
    }

    try {
      // Fetch the page
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'CODEX-DocMiner/1.0',
          'Accept': 'text/html,application/xhtml+xml'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();

      // Parse with cheerio
      const $ = cheerio.load(html);

      // Remove unwanted elements
      $('script, style, nav, footer, header, aside, .sidebar, .navigation').remove();

      // Get title
      const title = $('title').text() || $('h1').first().text() || 'Untitled';

      // Get main content
      const mainContent = $('main, article, .content, .documentation, #content, .markdown-body')
        .first();

      const contentHtml = mainContent.length > 0
        ? mainContent.html()
        : $('body').html();

      if (!contentHtml) {
        throw new Error('No content found on page');
      }

      // Convert to markdown
      const markdown = this.turndown.turndown(contentHtml);

      // Extract sections
      const sections = this.extractSections($, mainContent.length > 0 ? mainContent : $('body'));

      // Cache the result
      const cachedDoc: CachedDoc = {
        url,
        title,
        content: markdown,
        markdown,
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + (this.config.cacheTTL ?? 3600) * 1000)
      };

      await this.saveToCache(cachedDoc);

      return {
        url,
        title,
        content: markdown,
        sections,
        fetchedAt: new Date(),
        cached: false
      };
    } catch (error) {
      throw new Error(`Failed to fetch documentation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Search cached documentation
   */
  async search(query: string): Promise<DocSearchResult> {
    const results: DocSearchResult['results'] = [];
    const queryLower = query.toLowerCase();

    // Search in-memory cache
    for (const [url, doc] of this.cache) {
      const relevance = this.calculateRelevance(doc, queryLower);
      if (relevance > 0) {
        const snippet = this.extractSnippet(doc.content, queryLower);
        results.push({
          url,
          title: doc.title,
          snippet,
          relevance
        });
      }
    }

    // Search file cache
    try {
      const cacheFiles = await fs.readdir(this.cacheDir);
      for (const file of cacheFiles) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.cacheDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const doc: CachedDoc = JSON.parse(content);

        // Skip if already in memory cache
        if (this.cache.has(doc.url)) continue;

        const relevance = this.calculateRelevance(doc, queryLower);
        if (relevance > 0) {
          const snippet = this.extractSnippet(doc.content, queryLower);
          results.push({
            url: doc.url,
            title: doc.title,
            snippet,
            relevance
          });
        }
      }
    } catch {
      // Cache directory doesn't exist or is empty
    }

    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);

    return {
      query,
      results: results.slice(0, 10)
    };
  }

  /**
   * Get documentation for a npm package
   */
  async getPackageDocs(packageName: string): Promise<DocFetchResult | null> {
    // Try common documentation URLs
    const urls = [
      `https://www.npmjs.com/package/${packageName}`,
      `https://github.com/${packageName}/${packageName}#readme`,
      `https://unpkg.com/${packageName}/README.md`
    ];

    for (const url of urls) {
      try {
        return await this.fetch(url);
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Clear expired cache entries
   */
  async clearExpiredCache(): Promise<number> {
    let cleared = 0;
    const now = new Date();

    // Clear in-memory cache
    for (const [url, doc] of this.cache) {
      if (doc.expiresAt < now) {
        this.cache.delete(url);
        cleared++;
      }
    }

    // Clear file cache
    try {
      const cacheFiles = await fs.readdir(this.cacheDir);
      for (const file of cacheFiles) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.cacheDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const doc: CachedDoc = JSON.parse(content);

        if (new Date(doc.expiresAt) < now) {
          await fs.unlink(filePath);
          cleared++;
        }
      }
    } catch {
      // Cache directory doesn't exist
    }

    return cleared;
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private async getCached(url: string): Promise<CachedDoc | null> {
    // Check in-memory cache
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > new Date()) {
      return cached;
    }

    // Check file cache
    try {
      const cacheKey = this.urlToCacheKey(url);
      const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);
      const content = await fs.readFile(cachePath, 'utf-8');
      const doc: CachedDoc = JSON.parse(content);

      if (new Date(doc.expiresAt) > new Date()) {
        // Add to memory cache
        this.cache.set(url, doc);
        return doc;
      }
    } catch {
      // Cache miss
    }

    return null;
  }

  private async saveToCache(doc: CachedDoc): Promise<void> {
    // Save to memory cache
    this.cache.set(doc.url, doc);

    // Save to file cache
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const cacheKey = this.urlToCacheKey(doc.url);
      const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);
      await fs.writeFile(cachePath, JSON.stringify(doc, null, 2));
    } catch {
      // File cache save failed, but memory cache is still valid
    }
  }

  private urlToCacheKey(url: string): string {
    return Buffer.from(url).toString('base64')
      .replace(/[/+=]/g, '_')
      .substring(0, 100);
  }

  private formatCachedResult(cached: CachedDoc): DocFetchResult {
    return {
      url: cached.url,
      title: cached.title,
      content: cached.content,
      sections: [], // Would need to re-parse for sections
      fetchedAt: cached.fetchedAt,
      cached: true
    };
  }

  private extractSections($: cheerio.CheerioAPI, container: cheerio.Cheerio<Element>): DocSection[] {
    const sections: DocSection[] = [];

    container.find('h1, h2, h3, h4, h5, h6').each((_, element) => {
      const $el = $(element);
      const tagName = element.tagName.toLowerCase();
      const level = parseInt(tagName.replace('h', ''), 10);
      const heading = $el.text().trim();

      // Get content until next heading
      let content = '';
      let next = $el.next();
      while (next.length && !next.is('h1, h2, h3, h4, h5, h6')) {
        content += this.turndown.turndown(next.html() ?? '');
        next = next.next();
      }

      // Extract code examples
      const codeExamples: DocSection['codeExamples'] = [];
      $el.nextUntil('h1, h2, h3, h4, h5, h6').find('pre code').each((_, codeEl) => {
        const $code = $(codeEl);
        const language = $code.attr('class')?.match(/language-(\w+)/)?.[1] ?? '';
        codeExamples.push({
          language,
          code: $code.text()
        });
      });

      if (heading) {
        sections.push({
          heading,
          level,
          content: content.trim(),
          codeExamples
        });
      }
    });

    return sections;
  }

  private calculateRelevance(doc: CachedDoc, query: string): number {
    let score = 0;

    // Title match
    if (doc.title.toLowerCase().includes(query)) {
      score += 2;
    }

    // Content matches
    const content = doc.content.toLowerCase();
    const matches = content.split(query).length - 1;
    score += Math.min(matches * 0.1, 1);

    return score;
  }

  private extractSnippet(content: string, query: string): string {
    const index = content.toLowerCase().indexOf(query);
    if (index === -1) {
      return content.substring(0, 150) + '...';
    }

    const start = Math.max(0, index - 50);
    const end = Math.min(content.length, index + query.length + 100);
    let snippet = content.substring(start, end);

    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';

    return snippet;
  }
}

export default DocMiner;
