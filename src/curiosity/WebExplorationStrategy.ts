/**
 * WebExplorationStrategy
 *
 * Handles web-based curiosity exploration using Playwright.
 * Features:
 * - Google search exploration
 * - Direct URL visits
 * - Content extraction
 * - Screenshot capture
 * - VISIBLE browser (headless: false) for user observation
 */

import { PlaywrightManager } from '../playwright/PlaywrightManager.js';
import type {
  CuriosityProbe,
  WebExplorationConfig,
  WebExplorationResult,
  ExtractedPageContent,
} from './types.js';

export interface WebExplorationStrategyConfig {
  screenshotDir?: string;
  defaultMaxPages?: number;
  pageLoadTimeout?: number;
  slowMo?: number;
}

const DEFAULT_CONFIG: Required<WebExplorationStrategyConfig> = {
  screenshotDir: './screenshots/curiosity',
  defaultMaxPages: 3,
  pageLoadTimeout: 30000,
  slowMo: 100,  // Slight delay so user can watch
};

/**
 * Web exploration strategy for curiosity probes
 */
export class WebExplorationStrategy {
  private playwright: PlaywrightManager;
  private config: Required<WebExplorationStrategyConfig>;

  constructor(
    playwright: PlaywrightManager,
    config: WebExplorationStrategyConfig = {}
  ) {
    this.playwright = playwright;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Explore based on probe's web configuration
   */
  async explore(probe: CuriosityProbe): Promise<WebExplorationResult> {
    const webConfig = probe.webConfig || this.inferWebConfig(probe);
    return this.exploreWithConfig(webConfig, probe.question);
  }

  /**
   * Explore directly with a web configuration
   */
  async exploreWithConfig(
    webConfig: WebExplorationConfig,
    context?: string
  ): Promise<WebExplorationResult> {
    const startTime = Date.now();
    const screenshots: string[] = [];
    const visitedUrls: string[] = [];
    const pageContents: ExtractedPageContent[] = [];

    let sessionId: string | null = null;

    try {
      // Launch browser - VISIBLE so user can watch
      console.log('[WebExploration] Launching visible browser...');
      const session = await this.playwright.launch({
        headless: false,  // User can watch!
        viewport: { width: 1280, height: 800 },
        captureConsole: true,
        screenshotOnFailure: true,
        screenshotDir: this.config.screenshotDir,
        slowMo: this.config.slowMo,
      });
      sessionId = session.sessionId;
      console.log(`[WebExploration] Browser launched, session: ${sessionId}`);

      const maxPages = webConfig.maxPages ?? this.config.defaultMaxPages;
      const captureScreenshots = webConfig.captureScreenshots !== false;

      // Determine exploration strategy
      if (webConfig.searchQuery) {
        // Google search exploration
        console.log(`[WebExploration] Searching Google: "${webConfig.searchQuery}"`);
        const searchResults = await this.searchAndExplore(
          sessionId,
          webConfig.searchQuery,
          maxPages,
          webConfig.selectors,
          captureScreenshots,
          screenshots,
          visitedUrls,
          pageContents
        );

        if (!searchResults.success) {
          return {
            success: false,
            screenshots,
            visitedUrls,
            pageContents,
            searchQuery: webConfig.searchQuery,
            error: searchResults.error,
            durationMs: Date.now() - startTime,
          };
        }
      } else if (webConfig.urls && webConfig.urls.length > 0) {
        // Direct URL visits
        console.log(`[WebExploration] Visiting ${webConfig.urls.length} direct URLs`);
        const urlsToVisit = webConfig.urls.slice(0, maxPages);

        for (const url of urlsToVisit) {
          await this.visitAndExtract(
            sessionId,
            url,
            webConfig.selectors,
            captureScreenshots,
            screenshots,
            visitedUrls,
            pageContents
          );
        }
      } else {
        // No search query or URLs - try to infer from context
        if (context) {
          const inferredQuery = this.inferSearchQuery(context);
          console.log(`[WebExploration] Inferred search query: "${inferredQuery}"`);

          await this.searchAndExplore(
            sessionId,
            inferredQuery,
            maxPages,
            webConfig.selectors,
            captureScreenshots,
            screenshots,
            visitedUrls,
            pageContents
          );
        } else {
          return {
            success: false,
            screenshots: [],
            visitedUrls: [],
            pageContents: [],
            error: 'No search query, URLs, or context provided',
            durationMs: Date.now() - startTime,
          };
        }
      }

      console.log(`[WebExploration] Exploration complete. Visited ${visitedUrls.length} URLs`);

      return {
        success: true,
        screenshots,
        visitedUrls,
        pageContents,
        searchQuery: webConfig.searchQuery,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      console.error('[WebExploration] Error:', error);
      return {
        success: false,
        screenshots,
        visitedUrls,
        pageContents,
        searchQuery: webConfig.searchQuery,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      };
    } finally {
      // Always close the browser session
      if (sessionId) {
        try {
          await this.playwright.close(sessionId);
          console.log('[WebExploration] Browser closed');
        } catch {
          // Ignore close errors
        }
      }
    }
  }

  /**
   * Search Google and explore top results
   */
  private async searchAndExplore(
    sessionId: string,
    query: string,
    maxPages: number,
    selectors: string[] | undefined,
    captureScreenshots: boolean,
    screenshots: string[],
    visitedUrls: string[],
    pageContents: ExtractedPageContent[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Navigate to Google search
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      const navResult = await this.playwright.navigate(sessionId, searchUrl, {
        waitUntil: 'networkidle',
        timeout: this.config.pageLoadTimeout,
      });

      if (!navResult.success) {
        return { success: false, error: `Failed to load Google: ${navResult.error}` };
      }

      visitedUrls.push(searchUrl);

      // Screenshot the search results
      if (captureScreenshots) {
        const screenshot = await this.playwright.screenshot(sessionId, {
          label: 'google-search-results',
          fullPage: false,
        });
        screenshots.push(screenshot.path);
      }

      // Wait a moment for dynamic content
      await this.delay(500);

      // Get search result links
      const searchResultLinks = await this.extractSearchResultLinks(sessionId);
      console.log(`[WebExploration] Found ${searchResultLinks.length} search results`);

      // Visit top results (up to maxPages - 1, since we already visited Google)
      const linksToVisit = searchResultLinks.slice(0, maxPages - 1);

      for (const link of linksToVisit) {
        await this.visitAndExtract(
          sessionId,
          link,
          selectors,
          captureScreenshots,
          screenshots,
          visitedUrls,
          pageContents
        );
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
      };
    }
  }

  /**
   * Extract search result links from Google
   */
  private async extractSearchResultLinks(sessionId: string): Promise<string[]> {
    try {
      const links = await this.playwright.evaluate<string[]>(
        sessionId,
        `
        (() => {
          const links = [];
          // Main search results
          const results = document.querySelectorAll('div.g a[href^="http"]');
          results.forEach(a => {
            const href = a.getAttribute('href');
            // Filter out Google's own URLs and tracking URLs
            if (href && !href.includes('google.com') && !href.includes('webcache')) {
              links.push(href);
            }
          });
          return [...new Set(links)].slice(0, 10);  // Dedupe and limit
        })()
        `
      );
      return links;
    } catch (error) {
      console.error('[WebExploration] Failed to extract search links:', error);
      return [];
    }
  }

  /**
   * Visit a URL and extract content
   */
  private async visitAndExtract(
    sessionId: string,
    url: string,
    selectors: string[] | undefined,
    captureScreenshots: boolean,
    screenshots: string[],
    visitedUrls: string[],
    pageContents: ExtractedPageContent[]
  ): Promise<void> {
    try {
      console.log(`[WebExploration] Visiting: ${url}`);

      const navResult = await this.playwright.navigate(sessionId, url, {
        waitUntil: 'networkidle',
        timeout: this.config.pageLoadTimeout,
      });

      if (!navResult.success) {
        console.log(`[WebExploration] Failed to load: ${url} - ${navResult.error}`);
        return;
      }

      visitedUrls.push(navResult.url);

      // Screenshot
      if (captureScreenshots) {
        const urlLabel = this.urlToLabel(url);
        const screenshot = await this.playwright.screenshot(sessionId, {
          label: urlLabel,
          fullPage: false,
        });
        screenshots.push(screenshot.path);
      }

      // Extract content
      const title = await this.playwright.getTitle(sessionId);
      const text = await this.extractPageText(sessionId, selectors);

      pageContents.push({
        url: navResult.url,
        title,
        text,
        extractedAt: new Date(),
      });

      // Small delay between pages
      await this.delay(300);
    } catch (error) {
      console.error(`[WebExploration] Error visiting ${url}:`, error);
    }
  }

  /**
   * Extract text content from page
   */
  private async extractPageText(
    sessionId: string,
    selectors?: string[]
  ): Promise<string> {
    try {
      if (selectors && selectors.length > 0) {
        // Extract from specific selectors
        const texts: string[] = [];
        for (const selector of selectors) {
          const text = await this.playwright.evaluate<string>(
            sessionId,
            `
            (() => {
              const elements = document.querySelectorAll('${selector.replace(/'/g, "\\'")}');
              return Array.from(elements).map(el => el.textContent || '').join('\\n');
            })()
            `
          );
          if (text.trim()) {
            texts.push(text.trim());
          }
        }
        return texts.join('\n\n');
      } else {
        // Extract main content heuristically
        const text = await this.playwright.evaluate<string>(
          sessionId,
          `
          (() => {
            // Try common content selectors
            const contentSelectors = [
              'main',
              'article',
              '[role="main"]',
              '.content',
              '.main-content',
              '#content',
              '#main',
              '.post-content',
              '.article-content',
              '.entry-content',
              '.markdown-body',
              '.documentation',
              '.docs-content'
            ];

            for (const selector of contentSelectors) {
              const el = document.querySelector(selector);
              if (el && el.textContent && el.textContent.trim().length > 200) {
                return el.textContent.trim().slice(0, 10000);
              }
            }

            // Fallback to body, removing nav/header/footer
            const body = document.body.cloneNode(true);
            ['nav', 'header', 'footer', 'script', 'style', 'aside', '.sidebar', '.navigation'].forEach(sel => {
              body.querySelectorAll(sel).forEach(el => el.remove());
            });
            return (body.textContent || '').trim().slice(0, 10000);
          })()
          `
        );
        return text;
      }
    } catch (error) {
      console.error('[WebExploration] Failed to extract text:', error);
      return '';
    }
  }

  /**
   * Infer web config from probe properties
   */
  private inferWebConfig(probe: CuriosityProbe): WebExplorationConfig {
    // Try to create a search query from the probe's question and domain
    const searchQuery = `${probe.domain} ${probe.question}`;

    return {
      searchQuery: searchQuery.slice(0, 200),  // Limit query length
      maxPages: 3,
      captureScreenshots: true,
    };
  }

  /**
   * Infer a search query from context string
   */
  private inferSearchQuery(context: string): string {
    // Clean up and truncate the context to make a reasonable search query
    const cleaned = context
      .replace(/[^\w\s-]/g, ' ')  // Remove special chars
      .replace(/\s+/g, ' ')       // Collapse whitespace
      .trim()
      .slice(0, 100);             // Limit length

    return cleaned || 'documentation best practices';
  }

  /**
   * Convert URL to a safe filename label
   */
  private urlToLabel(url: string): string {
    try {
      const urlObj = new URL(url);
      const host = urlObj.hostname.replace(/\./g, '-');
      const path = urlObj.pathname
        .replace(/\//g, '-')
        .replace(/[^a-zA-Z0-9-]/g, '')
        .slice(0, 30);
      return `${host}${path}`.slice(0, 50);
    } catch {
      return 'page';
    }
  }

  /**
   * Simple delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default WebExplorationStrategy;
