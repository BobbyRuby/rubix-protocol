/**
 * Phase 5: Temporal Hyperedges (TTL-based Expiry) Tests
 *
 * Tests for:
 * 1. Creating causal relations with TTL
 * 2. Automatic expiration of relations
 * 3. Cleanup of expired relations
 * 4. Active vs expired relation filtering
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryEngine, MemorySource, CausalRelationType } from './index.js';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

describe('Phase 5: Temporal Hyperedges', () => {
  let engine: MemoryEngine;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = join(process.cwd(), `test-phase5-ttl-${Date.now()}.db`);

    try {
      if (existsSync(testDbPath)) rmSync(testDbPath);
      if (existsSync(testDbPath + '.idx')) rmSync(testDbPath + '.idx');
    } catch (e) {
      // Ignore cleanup errors
    }

    engine = new MemoryEngine({
      storageConfig: {
        sqlitePath: testDbPath,
        indexPath: testDbPath + '.idx',
        enableWAL: false
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

  it('should create a permanent causal relation (no TTL)', async () => {
    // Create two entries
    const entry1 = await engine.store('Source event', { source: MemorySource.USER_INPUT });
    const entry2 = await engine.store('Target event', { source: MemorySource.USER_INPUT });

    // Create permanent relation (no TTL)
    const relation = engine.addCausalRelation(
      [entry1.id],
      [entry2.id],
      CausalRelationType.CAUSES,
      0.8
    );

    expect(relation).toBeDefined();
    expect(relation.ttl).toBeUndefined();
    expect(relation.expiresAt).toBeUndefined();

    // Verify it can be retrieved
    const retrieved = engine.getCausalRelation(relation.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.ttl).toBeUndefined();
  });

  it('should create a temporal causal relation with TTL', async () => {
    const entry1 = await engine.store('Market signal', { source: MemorySource.USER_INPUT });
    const entry2 = await engine.store('Price action', { source: MemorySource.USER_INPUT });

    // Create relation with 7-day TTL
    const ttl = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
    const relation = engine.addCausalRelation(
      [entry1.id],
      [entry2.id],
      CausalRelationType.CORRELATES,
      0.85,
      { ttl }
    );

    expect(relation).toBeDefined();
    expect(relation.ttl).toBe(ttl);
    expect(relation.expiresAt).toBeDefined();

    // expiresAt should be approximately now + ttl
    const expectedExpiry = new Date(relation.createdAt.getTime() + ttl);
    expect(relation.expiresAt?.getTime()).toBeCloseTo(expectedExpiry.getTime(), -3);

    // Verify it can be retrieved with TTL info
    const retrieved = engine.getCausalRelation(relation.id);
    expect(retrieved?.ttl).toBe(ttl);
    expect(retrieved?.expiresAt).toBeDefined();
  });

  it('should create relation with metadata and TTL', async () => {
    const entry1 = await engine.store('Fed rate hike', { source: MemorySource.USER_INPUT });
    const entry2 = await engine.store('Bank stocks rally', { source: MemorySource.USER_INPUT });

    const relation = engine.addCausalRelation(
      [entry1.id],
      [entry2.id],
      CausalRelationType.CORRELATES,
      0.9,
      {
        ttl: 30 * 24 * 60 * 60 * 1000, // 30 days
        metadata: { regime: 'normal', confidence_source: 'historical' }
      }
    );

    expect(relation.ttl).toBe(30 * 24 * 60 * 60 * 1000);
    expect(relation.metadata).toEqual({ regime: 'normal', confidence_source: 'historical' });
  });

  it('should not return expired relations in active queries', async () => {
    const entry1 = await engine.store('Entry 1', { source: MemorySource.USER_INPUT });
    const entry2 = await engine.store('Entry 2', { source: MemorySource.USER_INPUT });

    // Create a relation that expires in 1ms (will be expired almost immediately)
    const relation = engine.addCausalRelation(
      [entry1.id],
      [entry2.id],
      CausalRelationType.CAUSES,
      0.8,
      { ttl: 1 } // 1 millisecond - expires almost instantly
    );

    expect(relation.expiresAt).toBeDefined();

    // Wait a tiny bit to ensure expiration
    await new Promise(resolve => setTimeout(resolve, 10));

    // The relation should be considered expired now
    const expiredCount = engine.getExpiredRelationCount();
    expect(expiredCount).toBe(1);

    // Get expired relations
    const expiredRelations = engine.getExpiredRelations();
    expect(expiredRelations.length).toBe(1);
    expect(expiredRelations[0].id).toBe(relation.id);
  });

  it('should cleanup expired relations', async () => {
    const entry1 = await engine.store('Entry A', { source: MemorySource.USER_INPUT });
    const entry2 = await engine.store('Entry B', { source: MemorySource.USER_INPUT });

    // Create an immediately expiring relation
    const expiredRelation = engine.addCausalRelation(
      [entry1.id],
      [entry2.id],
      CausalRelationType.PRECEDES,
      0.7,
      { ttl: 1 }
    );

    // Create a permanent relation
    const permanentRelation = engine.addCausalRelation(
      [entry1.id],
      [entry2.id],
      CausalRelationType.ENABLES,
      0.9
    );

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 10));

    // Cleanup expired relations
    const result = engine.cleanupExpiredRelations();

    expect(result.cleaned).toBe(1);
    expect(result.relationIds).toContain(expiredRelation.id);

    // Verify expired relation is gone
    const stillExpired = engine.getCausalRelation(expiredRelation.id);
    expect(stillExpired).toBeNull();

    // Verify permanent relation still exists
    const stillPermanent = engine.getCausalRelation(permanentRelation.id);
    expect(stillPermanent).toBeDefined();
    expect(stillPermanent?.id).toBe(permanentRelation.id);
  });

  it('should return 0 when no relations are expired', async () => {
    const entry1 = await engine.store('Entry X', { source: MemorySource.USER_INPUT });
    const entry2 = await engine.store('Entry Y', { source: MemorySource.USER_INPUT });

    // Create only permanent relations
    engine.addCausalRelation(
      [entry1.id],
      [entry2.id],
      CausalRelationType.CAUSES,
      0.8
    );

    // Create a relation that expires in the future (1 hour from now)
    engine.addCausalRelation(
      [entry1.id],
      [entry2.id],
      CausalRelationType.CORRELATES,
      0.7,
      { ttl: 60 * 60 * 1000 } // 1 hour
    );

    // No relations should be expired
    expect(engine.getExpiredRelationCount()).toBe(0);

    // Cleanup should return 0
    const result = engine.cleanupExpiredRelations();
    expect(result.cleaned).toBe(0);
  });

  it('should handle multiple expired relations', async () => {
    const entries = await Promise.all([
      engine.store('Event 1', { source: MemorySource.USER_INPUT }),
      engine.store('Event 2', { source: MemorySource.USER_INPUT }),
      engine.store('Event 3', { source: MemorySource.USER_INPUT })
    ]);

    // Create multiple immediately expiring relations
    const relation1 = engine.addCausalRelation(
      [entries[0].id],
      [entries[1].id],
      CausalRelationType.CAUSES,
      0.8,
      { ttl: 1 }
    );

    const relation2 = engine.addCausalRelation(
      [entries[1].id],
      [entries[2].id],
      CausalRelationType.ENABLES,
      0.7,
      { ttl: 1 }
    );

    const relation3 = engine.addCausalRelation(
      [entries[0].id],
      [entries[2].id],
      CausalRelationType.PRECEDES,
      0.6,
      { ttl: 1 }
    );

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 10));

    // All 3 should be expired
    expect(engine.getExpiredRelationCount()).toBe(3);

    // Cleanup all
    const result = engine.cleanupExpiredRelations();
    expect(result.cleaned).toBe(3);
    expect(result.relationIds).toContain(relation1.id);
    expect(result.relationIds).toContain(relation2.id);
    expect(result.relationIds).toContain(relation3.id);

    // No more expired relations
    expect(engine.getExpiredRelationCount()).toBe(0);
  }, 60000); // 60 second timeout for multiple embedding operations
});

describe('Phase 5: TTL Constants Helper', () => {
  it('should calculate common TTL values correctly', () => {
    // Helper constants that could be used in practice
    const SECOND = 1000;
    const MINUTE = 60 * SECOND;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const WEEK = 7 * DAY;

    expect(MINUTE).toBe(60000);
    expect(HOUR).toBe(3600000);
    expect(DAY).toBe(86400000);
    expect(WEEK).toBe(604800000);

    // Common TTL use cases
    const shortTermCorrelation = DAY; // Intraday correlations
    const weeklyPattern = WEEK; // Weekly patterns
    const monthlyTrend = 30 * DAY; // Monthly trends
    const quarterlyRegime = 90 * DAY; // Quarterly regime shifts

    expect(shortTermCorrelation).toBe(86400000);
    expect(weeklyPattern).toBe(604800000);
    expect(monthlyTrend).toBe(2592000000);
    expect(quarterlyRegime).toBe(7776000000);
  });
});
