/**
 * Phase 4: Provenance Threshold & Pattern Pruning Tests
 *
 * Tests for:
 * 1. L-Score threshold enforcement during storage
 * 2. Pattern success tracking
 * 3. Pattern pruning functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryEngine, ProvenanceThresholdError, MemorySource } from './index.js';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

describe('Phase 4: Provenance Threshold Enforcement', () => {
  let engine: MemoryEngine;
  let testDbPath: string;

  beforeEach(async () => {
    // Use unique database path for each test run
    testDbPath = join(process.cwd(), `test-phase4-threshold-${Date.now()}.db`);

    // Clean up any existing test database
    try {
      if (existsSync(testDbPath)) rmSync(testDbPath);
      if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
    } catch (e) {
      // Ignore cleanup errors
    }

    engine = new MemoryEngine({
      storageConfig: {
        sqlitePath: testDbPath,

        enableWAL: false
      },
      // Enable threshold enforcement with default 0.3 threshold
      lScoreConfig: {
        depthDecay: 0.9,
        minScore: 0.01,
        threshold: 0.3,
        enforceThreshold: true
      }
    });
    await engine.initialize();
  });

  afterEach(async () => {
    try {
      if (engine) await engine.close();
    } catch (e) {
      // Ignore close errors
    }
    try {
      if (existsSync(testDbPath)) rmSync(testDbPath);
      if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
    } catch (e) {
      // Ignore cleanup errors on Windows
    }
  });

  it('should allow storing root entries (L-Score = 1.0)', async () => {
    // Root entries have L-Score 1.0, well above threshold
    const entry = await engine.store('Root entry - no parents', {
      source: MemorySource.USER_INPUT,
      importance: 0.8
    });

    expect(entry).toBeDefined();
    expect(entry.provenance.lScore).toBe(1.0);
    expect(entry.provenance.parentIds).toHaveLength(0);
  });

  it('should allow storing high-confidence derived entries', async () => {
    // Create a root entry
    const parent = await engine.store('Parent entry', {
      source: MemorySource.USER_INPUT
    });

    // Create a derived entry with high confidence
    const child = await engine.store('High confidence child', {
      parentIds: [parent.id],
      confidence: 0.9,
      relevance: 0.9
    });

    expect(child).toBeDefined();
    expect(child.provenance.parentIds).toContain(parent.id);
    expect(child.provenance.lScore).toBeGreaterThan(0.3);
  });

  it('should reject entries with L-Score below threshold', async () => {
    // Create a chain that will result in low L-Score
    const root = await engine.store('Root', { source: MemorySource.USER_INPUT });

    // Create middle entry with high confidence (so it passes threshold)
    const middle = await engine.store('Middle entry', {
      parentIds: [root.id],
      confidence: 0.8,
      relevance: 0.8
    });

    // Verify middle entry was stored successfully
    expect(middle).toBeDefined();
    expect(middle.provenance.lScore).toBeGreaterThanOrEqual(0.3);

    // Try to create a deep-derivation with very low confidence
    // This should result in L-Score below 0.3
    await expect(engine.store('Low quality derived entry', {
      parentIds: [middle.id],
      confidence: 0.2,
      relevance: 0.2
    })).rejects.toThrow(ProvenanceThresholdError);
  });

  it('should include L-Score in error message', async () => {
    const root = await engine.store('Root', { source: MemorySource.USER_INPUT });

    // Use higher confidence so middle passes threshold
    const middle = await engine.store('Middle entry', {
      parentIds: [root.id],
      confidence: 0.7,
      relevance: 0.7
    });

    expect(middle.provenance.lScore).toBeGreaterThanOrEqual(0.3);

    try {
      await engine.store('Very low quality', {
        parentIds: [middle.id],
        confidence: 0.2,
        relevance: 0.2
      });
      expect.fail('Should have thrown ProvenanceThresholdError');
    } catch (error) {
      expect(error).toBeInstanceOf(ProvenanceThresholdError);
      if (error instanceof ProvenanceThresholdError) {
        expect(error.lScore).toBeLessThan(0.3);
        expect(error.threshold).toBe(0.3);
        expect(error.message).toContain('below threshold');
      }
    }
  });
});

describe('Phase 4: Pattern Success Tracking', () => {
  let engine: MemoryEngine;
  const testDbPath = join(process.cwd(), 'test-phase4-patterns.db');

  beforeEach(async () => {
    if (existsSync(testDbPath)) rmSync(testDbPath);
    if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');

    engine = new MemoryEngine({
      storageConfig: {
        sqlitePath: testDbPath,

        enableWAL: false
      }
    });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
    if (existsSync(testDbPath)) rmSync(testDbPath);
    if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
  });

  it('should register and track pattern usage', () => {
    const patternMatcher = engine.getPatternMatcher();

    // Register a pattern
    const template = patternMatcher.registerTemplate(
      'test_pattern',
      'User {name} did {action}',
      [
        { name: 'name', type: 'entity', required: true },
        { name: 'action', type: 'text', required: true }
      ],
      1
    );

    expect(template.id).toBeDefined();
    expect(template.name).toBe('test_pattern');

    // Record some uses
    patternMatcher.recordUse(template.id, true);  // success
    patternMatcher.recordUse(template.id, true);  // success
    patternMatcher.recordUse(template.id, false); // failure

    // Check stats
    const stats = patternMatcher.getStats(template.id);
    expect(stats).toBeDefined();
    expect(stats!.useCount).toBe(3);
    expect(stats!.successCount).toBe(2);
    expect(stats!.successRate).toBeCloseTo(2 / 3, 2);
  });

  it('should track multiple pattern stats independently', () => {
    const patternMatcher = engine.getPatternMatcher();

    // Register two patterns
    const pattern1 = patternMatcher.registerTemplate(
      'pattern_a',
      'Hello {name}',
      [{ name: 'name', type: 'text', required: true }],
      1
    );

    const pattern2 = patternMatcher.registerTemplate(
      'pattern_b',
      'Goodbye {name}',
      [{ name: 'name', type: 'text', required: true }],
      1
    );

    // Record different success rates
    for (let i = 0; i < 10; i++) {
      patternMatcher.recordUse(pattern1.id, true); // 100% success
      patternMatcher.recordUse(pattern2.id, i < 3); // 30% success
    }

    const stats1 = patternMatcher.getStats(pattern1.id);
    const stats2 = patternMatcher.getStats(pattern2.id);

    expect(stats1!.successRate).toBe(1.0);
    expect(stats2!.successRate).toBe(0.3);
  });
});

describe('Phase 4: Pattern Pruning', () => {
  let engine: MemoryEngine;
  const testDbPath = join(process.cwd(), 'test-phase4-pruning.db');

  beforeEach(async () => {
    if (existsSync(testDbPath)) rmSync(testDbPath);
    if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');

    engine = new MemoryEngine({
      storageConfig: {
        sqlitePath: testDbPath,

        enableWAL: false
      }
    });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
    if (existsSync(testDbPath)) rmSync(testDbPath);
    if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
  });

  it('should identify prune candidates', () => {
    const patternMatcher = engine.getPatternMatcher();

    // Create a pattern with low success rate
    const badPattern = patternMatcher.registerTemplate(
      'bad_pattern',
      'Bad {thing}',
      [{ name: 'thing', type: 'text', required: true }],
      1
    );

    // Record 100+ uses with <40% success
    for (let i = 0; i < 110; i++) {
      patternMatcher.recordUse(badPattern.id, i < 30); // 30% success
    }

    // Should be a prune candidate
    const candidates = patternMatcher.getPruneCandidates();
    expect(candidates.length).toBe(1);
    expect(candidates[0].pattern.id).toBe(badPattern.id);
    expect(candidates[0].stats.successRate).toBeCloseTo(30 / 110, 2);
  });

  it('should not prune patterns with insufficient uses', () => {
    const patternMatcher = engine.getPatternMatcher();

    // Create a pattern with low success rate but few uses
    const newPattern = patternMatcher.registerTemplate(
      'new_pattern',
      'New {thing}',
      [{ name: 'thing', type: 'text', required: true }],
      1
    );

    // Record only 50 uses (below 100 threshold) with low success
    for (let i = 0; i < 50; i++) {
      patternMatcher.recordUse(newPattern.id, i < 10); // 20% success
    }

    // Should NOT be a prune candidate (needs 100+ uses)
    const candidates = patternMatcher.getPruneCandidates();
    expect(candidates.length).toBe(0);
  });

  it('should prune low-performance patterns', () => {
    const patternMatcher = engine.getPatternMatcher();

    // Create patterns with different success rates
    const goodPattern = patternMatcher.registerTemplate(
      'good_pattern',
      'Good {thing}',
      [{ name: 'thing', type: 'text', required: true }],
      1
    );

    const badPattern = patternMatcher.registerTemplate(
      'bad_pattern',
      'Bad {thing}',
      [{ name: 'thing', type: 'text', required: true }],
      1
    );

    // Good pattern: 80% success
    for (let i = 0; i < 100; i++) {
      patternMatcher.recordUse(goodPattern.id, i < 80);
    }

    // Bad pattern: 20% success
    for (let i = 0; i < 100; i++) {
      patternMatcher.recordUse(badPattern.id, i < 20);
    }

    // Prune should remove bad pattern only
    const result = patternMatcher.prunePatterns();

    expect(result.pruned).toBe(1);
    expect(result.patterns[0].name).toBe('bad_pattern');

    // Verify good pattern still exists
    const goodExists = patternMatcher.getTemplate('good_pattern');
    expect(goodExists).toBeDefined();

    // Verify bad pattern is gone
    const badExists = patternMatcher.getTemplate('bad_pattern');
    expect(badExists).toBeNull();
  });

  it('should delete specific pattern by ID', () => {
    const patternMatcher = engine.getPatternMatcher();

    const pattern = patternMatcher.registerTemplate(
      'deletable_pattern',
      'Delete {this}',
      [{ name: 'this', type: 'text', required: true }],
      1
    );

    // Verify it exists
    expect(patternMatcher.getTemplate('deletable_pattern')).toBeDefined();

    // Delete it
    const deleted = patternMatcher.deletePattern(pattern.id);
    expect(deleted).toBe(true);

    // Verify it's gone
    expect(patternMatcher.getTemplate('deletable_pattern')).toBeNull();
  });
});

describe('Phase 4: Threshold Disabled', () => {
  let engine: MemoryEngine;
  const testDbPath = join(process.cwd(), 'test-phase4-disabled.db');

  beforeEach(async () => {
    if (existsSync(testDbPath)) rmSync(testDbPath);
    if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');

    engine = new MemoryEngine({
      storageConfig: {
        sqlitePath: testDbPath,

        enableWAL: false
      },
      // Disable threshold enforcement
      lScoreConfig: {
        depthDecay: 0.9,
        minScore: 0.01,
        threshold: 0.3,
        enforceThreshold: false
      }
    });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
    if (existsSync(testDbPath)) rmSync(testDbPath);
    if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
  });

  it('should allow low L-Score entries when threshold is disabled', async () => {
    const root = await engine.store('Root', { source: MemorySource.USER_INPUT });

    const middle = await engine.store('Middle entry', {
      parentIds: [root.id],
      confidence: 0.4,
      relevance: 0.4
    });

    // This would fail with enforcement enabled, but should succeed here
    const lowQuality = await engine.store('Very low quality', {
      parentIds: [middle.id],
      confidence: 0.1,
      relevance: 0.1
    });

    expect(lowQuality).toBeDefined();
    expect(lowQuality.provenance.lScore).toBeLessThan(0.3);
  });
});
