/**
 * OutputSanitizer - Redacts secrets and sensitive data from output.
 *
 * Prevents accidental exposure of:
 * - API keys (Anthropic, OpenAI, AWS, etc.)
 * - Bearer tokens and JWTs
 * - Private keys
 * - Connection strings with credentials
 * - Inline passwords and secrets
 *
 * Singleton pattern - use getSanitizer() to access.
 */

export interface SanitizationPattern {
  regex: RegExp;
  replacement: string;
  description: string;
}

export class OutputSanitizer {
  private static instance: OutputSanitizer;
  private patterns: SanitizationPattern[];
  private enabled: boolean = true;

  private constructor() {
    this.patterns = [
      // API Keys - Anthropic (sk-ant-...)
      {
        regex: /sk-ant-[A-Za-z0-9-_]{40,}/g,
        replacement: 'sk-ant-***REDACTED***',
        description: 'Anthropic API key'
      },
      // API Keys - OpenAI (sk-proj-... or sk-...)
      {
        regex: /sk-proj-[A-Za-z0-9-_]{40,}/g,
        replacement: 'sk-proj-***REDACTED***',
        description: 'OpenAI project API key'
      },
      {
        regex: /sk-[A-Za-z0-9-_]{40,}/g,
        replacement: 'sk-***REDACTED***',
        description: 'Generic sk- API key'
      },
      // AWS Access Keys
      {
        regex: /AKIA[A-Z0-9]{16}/g,
        replacement: 'AKIA***REDACTED***',
        description: 'AWS Access Key ID'
      },
      {
        regex: /ASIA[A-Z0-9]{16}/g,
        replacement: 'ASIA***REDACTED***',
        description: 'AWS Temporary Access Key ID'
      },
      // AWS Secret Keys (40 char base64-like following a key pattern)
      {
        regex: /(aws_secret_access_key|secret_access_key|secretAccessKey)\s*[:=]\s*['"]?([A-Za-z0-9+/]{40})['"]?/gi,
        replacement: '$1: ***REDACTED***',
        description: 'AWS Secret Access Key'
      },
      // Bearer Tokens
      {
        regex: /Bearer\s+[A-Za-z0-9._-]{20,}/gi,
        replacement: 'Bearer ***REDACTED***',
        description: 'Bearer token'
      },
      // JWT Tokens (three base64url parts separated by dots)
      {
        regex: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
        replacement: '[JWT_REDACTED]',
        description: 'JWT token'
      },
      // Private Keys (PEM format, multiline)
      {
        regex: /-----BEGIN[^-]+PRIVATE KEY-----[\s\S]+?-----END[^-]+PRIVATE KEY-----/g,
        replacement: '[PRIVATE_KEY_REDACTED]',
        description: 'Private key (PEM format)'
      },
      // RSA Private Keys
      {
        regex: /-----BEGIN RSA PRIVATE KEY-----[\s\S]+?-----END RSA PRIVATE KEY-----/g,
        replacement: '[RSA_PRIVATE_KEY_REDACTED]',
        description: 'RSA Private key'
      },
      // Connection strings with credentials (postgres, mysql, mongodb, redis)
      {
        regex: /:\/\/([^:]+):([^@]{8,})@/g,
        replacement: '://***:***@',
        description: 'Connection string credentials'
      },
      // Inline password/secret assignments (various formats)
      {
        regex: /(password|passwd|pwd|secret|api_key|apikey|api-key|token|access_token|auth_token)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
        replacement: '$1: "***REDACTED***"',
        description: 'Inline secret assignment'
      },
      // Environment variable patterns in output
      {
        regex: /(ANTHROPIC_API_KEY|OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|DATABASE_URL|REDIS_URL|TELEGRAM_BOT_TOKEN)\s*=\s*[^\s\n]+/gi,
        replacement: '$1=***REDACTED***',
        description: 'Environment variable'
      },
      // GitHub tokens
      {
        regex: /ghp_[A-Za-z0-9]{36,}/g,
        replacement: 'ghp_***REDACTED***',
        description: 'GitHub Personal Access Token'
      },
      {
        regex: /github_pat_[A-Za-z0-9_]{22,}/g,
        replacement: 'github_pat_***REDACTED***',
        description: 'GitHub Fine-grained PAT'
      },
      // Slack tokens
      {
        regex: /xox[baprs]-[A-Za-z0-9-]{24,}/g,
        replacement: 'xox*-***REDACTED***',
        description: 'Slack token'
      },
      // Stripe keys
      {
        regex: /sk_live_[A-Za-z0-9]{24,}/g,
        replacement: 'sk_live_***REDACTED***',
        description: 'Stripe live secret key'
      },
      {
        regex: /sk_test_[A-Za-z0-9]{24,}/g,
        replacement: 'sk_test_***REDACTED***',
        description: 'Stripe test secret key'
      },
      // Discord webhook URLs
      {
        regex: /https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g,
        replacement: 'https://discord.com/api/webhooks/***REDACTED***',
        description: 'Discord webhook URL'
      },
      // Telegram bot tokens
      {
        regex: /\d{9,10}:[A-Za-z0-9_-]{35}/g,
        replacement: '***REDACTED_BOT_TOKEN***',
        description: 'Telegram bot token'
      }
    ];
  }

  /**
   * Get the singleton instance.
   */
  static getInstance(): OutputSanitizer {
    if (!OutputSanitizer.instance) {
      OutputSanitizer.instance = new OutputSanitizer();
    }
    return OutputSanitizer.instance;
  }

  /**
   * Sanitize text by redacting any detected secrets.
   */
  sanitize(text: string): string {
    if (!this.enabled || !text) {
      return text;
    }

    let sanitized = text;
    for (const pattern of this.patterns) {
      sanitized = sanitized.replace(pattern.regex, pattern.replacement);
    }
    return sanitized;
  }

  /**
   * Sanitize an Error object - returns a new Error with sanitized message.
   */
  sanitizeError(error: Error): Error {
    if (!this.enabled) {
      return error;
    }

    const sanitizedMessage = this.sanitize(error.message);
    const sanitizedStack = error.stack ? this.sanitize(error.stack) : undefined;

    const sanitizedError = new Error(sanitizedMessage);
    sanitizedError.name = error.name;
    if (sanitizedStack) {
      sanitizedError.stack = sanitizedStack;
    }

    return sanitizedError;
  }

  /**
   * Sanitize an object's string values recursively.
   */
  sanitizeObject<T>(obj: T): T {
    if (!this.enabled || !obj) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.sanitize(obj) as T;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item)) as T;
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          result[key] = this.sanitize(value);
        } else if (typeof value === 'object' && value !== null) {
          result[key] = this.sanitizeObject(value);
        } else {
          result[key] = value;
        }
      }
      return result as T;
    }

    return obj;
  }

  /**
   * Wrap console methods to automatically sanitize output.
   * Call this once at application startup.
   */
  wrapConsole(): void {
    if (!this.enabled) {
      return;
    }

    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;
    const originalDebug = console.debug;

    const sanitizeArg = (arg: unknown): unknown => {
      if (typeof arg === 'string') {
        return this.sanitize(arg);
      }
      if (arg instanceof Error) {
        return this.sanitizeError(arg);
      }
      return arg;
    };

    console.log = (...args: unknown[]) => {
      originalLog.apply(console, args.map(sanitizeArg));
    };

    console.error = (...args: unknown[]) => {
      originalError.apply(console, args.map(sanitizeArg));
    };

    console.warn = (...args: unknown[]) => {
      originalWarn.apply(console, args.map(sanitizeArg));
    };

    console.info = (...args: unknown[]) => {
      originalInfo.apply(console, args.map(sanitizeArg));
    };

    console.debug = (...args: unknown[]) => {
      originalDebug.apply(console, args.map(sanitizeArg));
    };

    console.log('[OutputSanitizer] Console wrapping enabled - secrets will be redacted');
  }

  /**
   * Enable or disable sanitization.
   * Useful for debugging (disable) or testing (toggle).
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[OutputSanitizer] Sanitization ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if sanitization is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Add a custom sanitization pattern.
   */
  addPattern(pattern: SanitizationPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Get all registered patterns (for debugging/testing).
   */
  getPatterns(): SanitizationPattern[] {
    return [...this.patterns];
  }

  /**
   * Test if text contains any detectable secrets.
   * Returns true if secrets are found.
   */
  containsSecrets(text: string): boolean {
    for (const pattern of this.patterns) {
      if (pattern.regex.test(text)) {
        // Reset regex lastIndex for global patterns
        pattern.regex.lastIndex = 0;
        return true;
      }
      // Reset for next pattern
      pattern.regex.lastIndex = 0;
    }
    return false;
  }
}

/**
 * Get the singleton OutputSanitizer instance.
 */
export function getSanitizer(): OutputSanitizer {
  return OutputSanitizer.getInstance();
}

/**
 * Convenience function to sanitize text.
 */
export function sanitize(text: string): string {
  return getSanitizer().sanitize(text);
}

/**
 * Convenience function to sanitize an error.
 */
export function sanitizeError(error: Error): Error {
  return getSanitizer().sanitizeError(error);
}
