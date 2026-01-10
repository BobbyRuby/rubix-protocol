/**
 * Shadow Search Test Suite
 *
 * Tests the adversarial shadow vector search functionality.
 */

import { ShadowSearch } from '../src/adversarial/ShadowSearch.js';

// Test vector inversion
function testVectorInversion() {
  console.log('Test 1: Vector Inversion');
  console.log('-'.repeat(40));

  const shadow = new ShadowSearch();

  // Create a test vector
  const original = new Float32Array([0.3, -0.2, 0.8, 0.1, -0.5]);
  const inverted = shadow.invert(original);

  console.log(`  Original: [${Array.from(original).map(v => v.toFixed(2)).join(', ')}]`);
  console.log(`  Inverted: [${Array.from(inverted).map(v => v.toFixed(2)).join(', ')}]`);

  // Verify inversion
  let correct = true;
  for (let i = 0; i < original.length; i++) {
    if (Math.abs(original[i] + inverted[i]) > 0.0001) {
      correct = false;
      break;
    }
  }

  console.log(`  Inversion correct: ${correct ? '✓' : '✗'}`);
  console.log('');

  return correct;
}

// Test credibility calculation
function testCredibilityCalculation() {
  console.log('Test 2: Credibility Calculation');
  console.log('-'.repeat(40));

  const shadow = new ShadowSearch();

  // Scenario 1: Strong support, weak contradictions
  const result1 = shadow.calculateCredibility(
    [{ score: 0.9, lScore: 0.8 }, { score: 0.85, lScore: 0.7 }],
    [{ refutationStrength: 0.3, lScore: 0.5 } as any]
  );

  console.log('  Scenario 1: Strong support, weak contradiction');
  console.log(`    Credibility: ${result1.credibility.toFixed(4)}`);
  console.log(`    Expected: > 0.7 → ${result1.credibility > 0.7 ? '✓' : '✗'}`);

  // Scenario 2: Balanced support and contradictions
  const result2 = shadow.calculateCredibility(
    [{ score: 0.7, lScore: 0.7 }],
    [{ refutationStrength: 0.7, lScore: 0.7 } as any]
  );

  console.log('  Scenario 2: Balanced support and contradiction');
  console.log(`    Credibility: ${result2.credibility.toFixed(4)}`);
  console.log(`    Expected: ~0.5 → ${Math.abs(result2.credibility - 0.5) < 0.1 ? '✓' : '✗'}`);

  // Scenario 3: Strong contradictions
  const result3 = shadow.calculateCredibility(
    [{ score: 0.3, lScore: 0.5 }],
    [{ refutationStrength: 0.9, lScore: 0.9 }, { refutationStrength: 0.85, lScore: 0.8 }] as any
  );

  console.log('  Scenario 3: Strong contradictions');
  console.log(`    Credibility: ${result3.credibility.toFixed(4)}`);
  console.log(`    Expected: < 0.3 → ${result3.credibility < 0.3 ? '✓' : '✗'}`);
  console.log('');

  return result1.credibility > 0.7 &&
         Math.abs(result2.credibility - 0.5) < 0.1 &&
         result3.credibility < 0.3;
}

// Test contradiction classification
function testContradictionClassification() {
  console.log('Test 3: Contradiction Classification');
  console.log('-'.repeat(40));

  const shadow = new ShadowSearch();

  // Access private method via type assertion for testing
  const classifyContradiction = (shadow as any).classifyContradiction.bind(shadow);

  const tests = [
    { strength: 0.9, expected: 'direct_negation' },
    { strength: 0.7, expected: 'counterargument' },
    { strength: 0.55, expected: 'alternative' },
    { strength: 0.4, expected: 'exception' }
  ];

  let allPassed = true;
  for (const test of tests) {
    const result = classifyContradiction(test.strength);
    const passed = result === test.expected;
    allPassed = allPassed && passed;
    console.log(`  Strength ${test.strength}: ${result} (expected: ${test.expected}) ${passed ? '✓' : '✗'}`);
  }

  console.log('');
  return allPassed;
}

// Run all tests
async function runTests() {
  console.log('='.repeat(60));
  console.log('Shadow Search Test Suite');
  console.log('='.repeat(60));
  console.log('');

  const results = [
    testVectorInversion(),
    testCredibilityCalculation(),
    testContradictionClassification()
  ];

  const passed = results.filter(r => r).length;
  const total = results.length;

  console.log('='.repeat(60));
  console.log(`Results: ${passed}/${total} tests passed`);
  console.log('='.repeat(60));

  if (passed === total) {
    console.log('All shadow search unit tests passed!');
  } else {
    console.log('Some tests failed.');
    process.exit(1);
  }
}

runTests().catch(console.error);
