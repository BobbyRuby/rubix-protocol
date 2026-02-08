import { describe, it, expect, beforeEach } from 'vitest';
import { Calculator } from '../src/app/Calculator';
import { CalculationService } from '../src/Services/CalculationService';
import { OperationType } from '../src/models/Operation';

describe('Calculator', () => {
  let calculator: Calculator;
  let calculationService: CalculationService;

  beforeEach(() => {
    calculationService = new CalculationService();
    calculator = new Calculator(calculationService);
  });

  describe('basic operations', () => {
    it('should add two numbers correctly', () => {
      const result = calculator.add(5, 3);
      
      expect(result.success).toBe(true);
      expect(result.result).toBe(8);
      expect(result.operation.type).toBe(OperationType.ADD);
      expect(result.operation.operandA).toBe(5);
      expect(result.operation.operandB).toBe(3);
    });

    it('should subtract two numbers correctly', () => {
      const result = calculator.subtract(10, 4);
      
      expect(result.success).toBe(true);
      expect(result.result).toBe(6);
      expect(result.operation.type).toBe(OperationType.SUBTRACT);
    });

    it('should multiply two numbers correctly', () => {
      const result = calculator.multiply(6, 7);
      
      expect(result.success).toBe(true);
      expect(result.result).toBe(42);
      expect(result.operation.type).toBe(OperationType.MULTIPLY);
    });

    it('should divide two numbers correctly', () => {
      const result = calculator.divide(15, 3);
      
      expect(result.success).toBe(true);
      expect(result.result).toBe(5);
      expect(result.operation.type).toBe(OperationType.DIVIDE);
    });

    it('should handle division by zero', () => {
      const result = calculator.divide(10, 0);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Division by zero is not allowed');
    });
  });

  describe('decimal operations', () => {
    it('should handle decimal addition', () => {
      const result = calculator.add(0.1, 0.2);
      
      expect(result.success).toBe(true);
      expect(result.result).toBeCloseTo(0.3);
    });

    it('should handle decimal division', () => {
      const result = calculator.divide(1, 3);
      
      expect(result.success).toBe(true);
      expect(result.result).toBeCloseTo(0.3333333333333333);
    });
  });

  describe('negative numbers', () => {
    it('should handle negative numbers in addition', () => {
      const result = calculator.add(-5, 3);
      
      expect(result.success).toBe(true);
      expect(result.result).toBe(-2);
    });

    it('should handle negative numbers in multiplication', () => {
      const result = calculator.multiply(-4, -3);
      
      expect(result.success).toBe(true);
      expect(result.result).toBe(12);
    });
  });

  describe('history management', () => {
    it('should track calculation history', () => {
      calculator.add(1, 2);
      calculator.multiply(3, 4);
      
      const history = calculator.getHistory();
      
      expect(history).toHaveLength(2);
      expect(history[0].result).toBe(3);
      expect(history[1].result).toBe(12);
    });

    it('should clear history', () => {
      calculator.add(1, 2);
      calculator.clearHistory();
      
      const history = calculator.getHistory();
      
      expect(history).toHaveLength(0);
    });

    it('should get last result', () => {
      calculator.add(5, 5);
      const lastResult = calculator.getLastResult();
      
      expect(lastResult).not.toBeNull();
      expect(lastResult?.result).toBe(10);
    });

    it('should return null for last result when no calculations', () => {
      const lastResult = calculator.getLastResult();
      
      expect(lastResult).toBeNull();
    });
  });

  describe('direct operation calculation', () => {
    it('should calculate using operation object', () => {
      const operation = {
        type: OperationType.MULTIPLY,
        operandA: 8,
        operandB: 9
      };
      
      const result = calculator.calculate(operation);
      
      expect(result.success).toBe(true);
      expect(result.result).toBe(72);
    });
  });
});