import { describe, it, expect, beforeEach } from 'vitest';
import { CalculationService } from '../src/Services/CalculationService';
import { Operation, OperationType } from '../src/models/Operation';

describe('CalculationService', () => {
  let service: CalculationService;

  beforeEach(() => {
    service = new CalculationService();
  });

  describe('calculate method', () => {
    it('should perform addition correctly', () => {
      const operation: Operation = {
        type: OperationType.ADD,
        operandA: 10,
        operandB: 5
      };

      const result = service.calculate(operation);

      expect(result.success).toBe(true);
      expect(result.result).toBe(15);
      expect(result.operation.operandA).toBe(10);
      expect(result.operation.operandB).toBe(5);
      expect(result.calculatedAt).toBeInstanceOf(Date);
    });

    it('should perform subtraction correctly', () => {
      const operation: Operation = {
        type: OperationType.SUBTRACT,
        operandA: 20,
        operandB: 8
      };

      const result = service.calculate(operation);

      expect(result.success).toBe(true);
      expect(result.result).toBe(12);
    });

    it('should perform multiplication correctly', () => {
      const operation: Operation = {
        type: OperationType.MULTIPLY,
        operandA: 4,
        operandB: 7
      };

      const result = service.calculate(operation);

      expect(result.success).toBe(true);
      expect(result.result).toBe(28);
    });

    it('should perform division correctly', () => {
      const operation: Operation = {
        type: OperationType.DIVIDE,
        operandA: 24,
        operandB: 6
      };

      const result = service.calculate(operation);

      expect(result.success).toBe(true);
      expect(result.result).toBe(4);
    });

    it('should handle division by zero', () => {
      const operation: Operation = {
        type: OperationType.DIVIDE,
        operandA: 10,
        operandB: 0
      };

      const result = service.calculate(operation);

      expect(result.success).toBe(false);
      expect(result.result).toBe(0);
      expect(result.error).toBe('Division by zero is not allowed');
    });

    it('should handle invalid operation type', () => {
      const operation: Operation = {
        type: 'invalid' as OperationType,
        operandA: 5,
        operandB: 3
      };

      const result = service.calculate(operation);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unsupported operation type: invalid');
    });
  });

  describe('history management', () => {
    it('should store calculation results in history', () => {
      const operation1: Operation = {
        type: OperationType.ADD,
        operandA: 1,
        operandB: 1
      };
      const operation2: Operation = {
        type: OperationType.MULTIPLY,
        operandA: 3,
        operandB: 3
      };

      service.calculate(operation1);
      service.calculate(operation2);

      const history = service.getHistory();

      expect(history).toHaveLength(2);
      expect(history[0].result).toBe(2);
      expect(history[1].result).toBe(9);
    });

    it('should store failed calculations in history', () => {
      const operation: Operation = {
        type: OperationType.DIVIDE,
        operandA: 5,
        operandB: 0
      };

      service.calculate(operation);

      const history = service.getHistory();

      expect(history).toHaveLength(1);
      expect(history[0].success).toBe(false);
    });

    it('should clear history', () => {
      const operation: Operation = {
        type: OperationType.ADD,
        operandA: 1,
        operandB: 2
      };

      service.calculate(operation);
      expect(service.getHistory()).toHaveLength(1);

      service.clearHistory();
      expect(service.getHistory()).toHaveLength(0);
    });

    it('should get last result', () => {
      const operation: Operation = {
        type: OperationType.SUBTRACT,
        operandA: 10,
        operandB: 3
      };

      service.calculate(operation);
      const lastResult = service.getLastResult();

      expect(lastResult).not.toBeNull();
      expect(lastResult?.result).toBe(7);
      expect(lastResult?.success).toBe(true);
    });

    it('should return null for last result when no history', () => {
      const lastResult = service.getLastResult();

      expect(lastResult).toBeNull();
    });
  });

  describe('operation timestamp handling', () => {
    it('should add timestamp to operations', () => {
      const operation: Operation = {
        type: OperationType.ADD,
        operandA: 5,
        operandB: 5
      };

      const result = service.calculate(operation);

      expect(result.operation.timestamp).toBeInstanceOf(Date);
      expect(result.calculatedAt).toBeInstanceOf(Date);
    });

    it('should preserve existing timestamp if present', () => {
      const existingTimestamp = new Date('2023-01-01');
      const operation: Operation = {
        type: OperationType.ADD,
        operandA: 2,
        operandB: 3,
        timestamp: existingTimestamp
      };

      const result = service.calculate(operation);

      expect(result.operation.timestamp).not.toBe(existingTimestamp);
      expect(result.operation.timestamp).toBeInstanceOf(Date);
    });
  });
});