/**
 * Test script for DaemonDetector
 *
 * Run with: npx tsx test-daemon-detection.ts
 */

import { DaemonDetector } from './src/utils/DaemonDetector.js';

async function testDaemonDetection() {
  console.log('=== Testing Daemon Detection ===\n');

  // Test 1: Initial detection
  console.log('Test 1: Detecting daemon status...');
  const status1 = await DaemonDetector.detect();
  console.log(`  Running: ${status1.running}`);
  console.log(`  Method: ${status1.method}`);
  console.log(`  Details: ${status1.details}`);
  console.log(`  Timestamp: ${status1.timestamp.toISOString()}`);
  console.log();

  // Test 2: Cached detection (should be instant)
  console.log('Test 2: Testing cache (should be instant)...');
  const startTime = Date.now();
  const status2 = await DaemonDetector.detect();
  const elapsed = Date.now() - startTime;
  console.log(`  Elapsed time: ${elapsed}ms`);
  console.log(`  Running: ${status2.running}`);
  console.log(`  Same timestamp as before: ${status1.timestamp.getTime() === status2.timestamp.getTime()}`);
  console.log();

  // Test 3: Check cached status without detection
  console.log('Test 3: Getting cached status...');
  const cached = DaemonDetector.getCached();
  if (cached) {
    console.log(`  Cached running: ${cached.running}`);
    console.log(`  Cache is fresh: true`);
  } else {
    console.log('  No cached status available');
  }
  console.log();

  // Test 4: Clear cache and re-detect
  console.log('Test 4: Clearing cache and re-detecting...');
  DaemonDetector.clearCache();
  const clearedCache = DaemonDetector.getCached();
  console.log(`  Cache cleared: ${clearedCache === null}`);
  const status3 = await DaemonDetector.detect();
  console.log(`  New detection running: ${status3.running}`);
  console.log(`  New detection method: ${status3.method}`);
  console.log();

  // Summary
  console.log('=== Summary ===');
  console.log(`Daemon is ${status3.running ? 'RUNNING' : 'NOT RUNNING'}`);
  console.log(`Primary detection method: ${status3.method}`);
  console.log();

  if (status3.running) {
    console.log('✅ Daemon detected - god_comms_escalate will use Telegram');
  } else {
    console.log('⚠️  Daemon not detected - god_comms_escalate will return CLI fallback');
    console.log('   To start daemon: node dist/launch/all.js');
  }
}

// Run the test
testDaemonDetection().catch(err => {
  console.error('Error during test:', err);
  process.exit(1);
});
