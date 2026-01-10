/**
 * Sona Learning Engine Tests
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync, unlinkSync, readdirSync } from 'fs';
import { SQLiteStorage } from '../storage/SQLiteStorage.js';
import { SonaEngine } from './SonaEngine.js';
import { TrajectoryStore } from './TrajectoryStore.js';
import { WeightManager } from './WeightManager.js';
import { EWCRegularizer } from './EWCRegularizer.js';

// Generate unique database path for each test
function uniqueDbPath(prefix: string): string {
  return `./test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`;
}

// Clean up all test databases after tests complete
afterAll(() => {
  try {
    const files = readdirSync('.');
    for (const file of files) {
      if (file.startsWith('test-') && file.endsWith('.db')) {
        try {
          unlinkSync(file);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  } catch {
    // Ignore
  }
});

describe('SonaEngine', () => {
  let storage: SQLiteStorage;
  let sona: SonaEngine;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = uniqueDbPath('sona');
    storage = new SQLiteStorage({ sqlitePath: testDbPath, indexPath: testDbPath + '.idx', enableWAL: false });
    sona = new SonaEngine(storage);
  });

  afterEach(() => {
    try {
      storage?.close();
    } catch {
      // Ignore
    }
    try {
      if (testDbPath && existsSync(testDbPath)) {
        unlinkSync(testDbPath);
      }
    } catch {
      // Ignore cleanup errors on Windows
    }
  });

  describe('Trajectory Creation', () => {
    it('should create a trajectory with matched patterns', () => {
      const trajectoryId = sona.createTrajectory(
        'test query',
        ['pattern1', 'pattern2'],
        [0.8, 0.6]
      );

      expect(trajectoryId).toBeDefined();
      expect(trajectoryId).toMatch(/^[0-9a-f-]+$/i);
    });

    it('should retrieve created trajectory', () => {
      const trajectoryId = sona.createTrajectory(
        'test query',
        ['pattern1', 'pattern2'],
        [0.8, 0.6]
      );

      const trajectory = sona.getTrajectory(trajectoryId);
      expect(trajectory).toBeDefined();
      expect(trajectory?.query).toBe('test query');
      expect(trajectory?.matchedIds).toEqual(['pattern1', 'pattern2']);
      expect(trajectory?.matchScores).toEqual([0.8, 0.6]);
    });
  });

  describe('Feedback Processing', () => {
    it('should process positive feedback and update weights', async () => {
      const trajectoryId = sona.createTrajectory(
        'successful query',
        ['pattern1', 'pattern2'],
        [0.9, 0.7]
      );

      const result = await sona.provideFeedback(trajectoryId, 0.9);

      expect(result.success).toBe(true);
      expect(result.weightsUpdated).toBe(2);
      expect(result.driftStatus).toBe('ok');
    });

    it('should process negative feedback and decrease weights', async () => {
      const trajectoryId = sona.createTrajectory(
        'failed query',
        ['pattern1'],
        [0.8]
      );

      const initialWeight = sona.getPatternWeight('pattern1');
      await sona.provideFeedback(trajectoryId, 0.1);
      const afterWeight = sona.getPatternWeight('pattern1');

      // Negative feedback (quality < 0.5) should decrease weight
      expect(afterWeight).toBeLessThan(initialWeight);
    });

    it('should handle non-existent trajectory gracefully', async () => {
      const result = await sona.provideFeedback('non-existent-id', 0.5);
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('Weight Application', () => {
    it('should apply learned weights to results', async () => {
      // Create and train on a pattern
      for (let i = 0; i < 3; i++) {
        const trajectoryId = sona.createTrajectory('good query', ['patternA'], [0.8]);
        await sona.provideFeedback(trajectoryId, 0.95);
      }

      // Apply weights
      const tracked = sona.applyWeights([
        { entryId: 'patternA', score: 0.7 },
        { entryId: 'patternB', score: 0.8 }
      ]);

      // Pattern A should get a boost from positive feedback
      const patternAResult = tracked.results.find(r => r.entryId === 'patternA');
      expect(patternAResult).toBeDefined();
      expect(patternAResult!.adjustedScore).toBeGreaterThan(patternAResult!.score * 0.9);
    });
  });

  describe('Drift Detection', () => {
    it('should detect drift from baseline', async () => {
      const initialDrift = sona.checkDrift();
      expect(initialDrift.drift).toBe(0);
      expect(initialDrift.status).toBe('ok');
    });

    it('should calculate drift after multiple updates', async () => {
      // Create multiple trajectories and provide feedback
      for (let i = 0; i < 5; i++) {
        const trajectoryId = sona.createTrajectory(
          `query ${i}`,
          [`pattern${i}`],
          [0.8]
        );
        await sona.provideFeedback(trajectoryId, i < 3 ? 0.9 : 0.1);
      }

      const drift = sona.checkDrift();
      expect(drift.drift).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Statistics', () => {
    it('should return comprehensive stats', async () => {
      const trajectoryId = sona.createTrajectory(
        'test query',
        ['pattern1'],
        [0.8]
      );
      await sona.provideFeedback(trajectoryId, 0.7);

      const stats = sona.getStats();

      expect(stats).toHaveProperty('totalTrajectories');
      expect(stats).toHaveProperty('trajectoriesWithFeedback');
      expect(stats).toHaveProperty('trackedPatterns');
      expect(stats).toHaveProperty('avgWeight');
      expect(stats).toHaveProperty('avgSuccessRate');
      expect(stats).toHaveProperty('currentDrift');
      expect(stats.totalTrajectories).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Checkpoint and Rollback', () => {
    it('should create and restore checkpoints', async () => {
      // Create some learning history
      const trajectoryId = sona.createTrajectory('query1', ['pattern1'], [0.9]);
      await sona.provideFeedback(trajectoryId, 0.9);

      // Create checkpoint
      const checkpointId = sona.createCheckpoint();
      expect(checkpointId).toBeDefined();

      // More training
      const trajectoryId2 = sona.createTrajectory('query2', ['pattern1'], [0.9]);
      await sona.provideFeedback(trajectoryId2, 0.1);

      // Rollback
      const success = sona.rollback(checkpointId);
      expect(success).toBe(true);
    });

    it('should rollback to latest checkpoint', async () => {
      const trajectoryId = sona.createTrajectory('query1', ['pattern1'], [0.9]);
      await sona.provideFeedback(trajectoryId, 0.9);

      sona.createCheckpoint();

      const rollbackSuccess = sona.rollbackToLatest();
      expect(rollbackSuccess).toBe(true);
    });
  });
});

describe('TrajectoryStore', () => {
  let storage: SQLiteStorage;
  let trajectoryStore: TrajectoryStore;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = uniqueDbPath('trajectory');
    storage = new SQLiteStorage({ sqlitePath: testDbPath, indexPath: testDbPath + '.idx', enableWAL: false });
    trajectoryStore = new TrajectoryStore(storage);
    trajectoryStore.initialize();
  });

  afterEach(() => {
    try {
      storage?.close();
    } catch {
      // Ignore
    }
    try {
      if (testDbPath && existsSync(testDbPath)) {
        unlinkSync(testDbPath);
      }
    } catch {
      // Ignore
    }
  });

  it('should store and retrieve trajectories', () => {
    const trajectory = trajectoryStore.createTrajectory(
      'test query',
      ['id1', 'id2'],
      [0.9, 0.7]
    );

    const retrieved = trajectoryStore.getTrajectory(trajectory.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.query).toBe('test query');
    expect(retrieved?.matchedIds).toEqual(['id1', 'id2']);
  });

  it('should store and retrieve feedback', () => {
    const trajectory = trajectoryStore.createTrajectory('test', ['id1'], [0.8]);
    trajectoryStore.storeFeedback(trajectory.id, 0.85, 'test-route');

    const feedbackList = trajectoryStore.getFeedback(trajectory.id);
    expect(feedbackList).toBeDefined();
    expect(feedbackList.length).toBe(1);
    expect(feedbackList[0].quality).toBe(0.85);
    expect(feedbackList[0].route).toBe('test-route');
  });

  it('should get pending feedback trajectories', () => {
    trajectoryStore.createTrajectory('query1', ['id1'], [0.8]);
    trajectoryStore.createTrajectory('query2', ['id2'], [0.7]);

    const pending = trajectoryStore.getPendingFeedback(10);
    expect(pending.length).toBe(2);
  });
});

describe('WeightManager', () => {
  let storage: SQLiteStorage;
  let weightManager: WeightManager;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = uniqueDbPath('weights');
    storage = new SQLiteStorage({ sqlitePath: testDbPath, indexPath: testDbPath + '.idx', enableWAL: false });
    weightManager = new WeightManager(storage);
    weightManager.initialize();
  });

  afterEach(() => {
    try {
      storage?.close();
    } catch {
      // Ignore
    }
    try {
      if (testDbPath && existsSync(testDbPath)) {
        unlinkSync(testDbPath);
      }
    } catch {
      // Ignore
    }
  });

  it('should return default weight for unknown patterns', () => {
    const weight = weightManager.getWeight('unknown-pattern');
    expect(weight).toBe(0.5); // Default neutral weight
  });

  it('should update and retrieve weights', () => {
    weightManager.updateWeight('pattern1', 0.75);
    const weight = weightManager.getWeight('pattern1');
    expect(weight).toBe(0.75);
  });

  it('should track usage statistics', () => {
    weightManager.recordUse('pattern1', true);
    weightManager.recordUse('pattern1', true);
    weightManager.recordUse('pattern1', false);

    const patternWeight = weightManager.getPatternWeight('pattern1');
    expect(patternWeight).toBeDefined();
    expect(patternWeight?.useCount).toBe(3);
    expect(patternWeight?.successCount).toBe(2);
  });

  it('should create and restore checkpoints', () => {
    weightManager.updateWeight('pattern1', 0.8);
    const checkpointId = weightManager.createCheckpoint(0.0);

    weightManager.updateWeight('pattern1', 0.3);
    expect(weightManager.getWeight('pattern1')).toBe(0.3);

    const restored = weightManager.restoreFromCheckpoint(checkpointId);
    expect(restored).toBe(true);
  });
});

describe('EWCRegularizer', () => {
  let storage: SQLiteStorage;
  let weightManager: WeightManager;
  let ewc: EWCRegularizer;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = uniqueDbPath('ewc');
    storage = new SQLiteStorage({ sqlitePath: testDbPath, indexPath: testDbPath + '.idx', enableWAL: false });
    weightManager = new WeightManager(storage);
    weightManager.initialize();
    ewc = new EWCRegularizer(weightManager);
  });

  afterEach(() => {
    try {
      storage?.close();
    } catch {
      // Ignore
    }
    try {
      if (testDbPath && existsSync(testDbPath)) {
        unlinkSync(testDbPath);
      }
    } catch {
      // Ignore
    }
  });

  it('should apply regularized updates', () => {
    const result = ewc.applyRegularizedUpdate('pattern1', 0.1);
    expect(result.oldWeight).toBe(0.5); // Default
    expect(result.newWeight).toBeGreaterThan(result.oldWeight);
  });

  it('should track importance', () => {
    ewc.updateImportance('pattern1', 0.5);
    ewc.updateImportance('pattern1', 0.3);

    const patternWeight = weightManager.getPatternWeight('pattern1');
    expect(patternWeight?.importance).toBeGreaterThan(0);
  });

  it('should calculate drift metrics', () => {
    const drift = ewc.calculateDrift();
    expect(drift).toHaveProperty('drift');
    expect(drift).toHaveProperty('threshold');
    expect(drift).toHaveProperty('status');
    expect(drift).toHaveProperty('shouldRollback');
  });

  it('should identify protected patterns', () => {
    // Create pattern and set high importance
    weightManager.updateWeight('important-pattern', 0.6);
    weightManager.updateImportance('important-pattern', 2.0);

    const protected_ = ewc.getProtectedPatterns(0.1);
    // Pattern with high importance * lambda (0.5 default) = 1.0 should exceed 0.1 threshold
    expect(protected_.includes('important-pattern')).toBe(true);
  });
});
