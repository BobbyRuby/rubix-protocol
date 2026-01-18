import { describe, it, expect, beforeEach } from 'vitest';
import { CalculatorController } from '../src/Http/Controllers/CalculatorController';
import { Calculator } from '../src/app/Calculator';
import { CalculationService } from '../src/Services/CalculationService';

describe('CalculatorController', () => {
  let controller: CalculatorController;
  let calculator: Calculator;
  let service: CalculationService;

  beforeEach(() => {
    service = new CalculationService();
    calculator = new Calculator(service);
    controller = new CalculatorController(calculator);
  });

  describe('calculate endpoint', () => {
    it('should handle valid calculation request', () => {
      const request = {
        operandA: 10,
        operandB: 5,
        operation: 'add'
      };

      const response = controller.calculate(request);

      expect(response.success).toBe(true);
      expect(response.data?.result).toBe(15);
      expect(response.data?.success).toBe(true);
      expect(response.timestamp).toBeInstanceOf(Date);
    });

    it('should handle invalid operands', () => {
      const request = {
        operandA: 'invalid' as any,
        operandB: 5,
        operation: 'add'
      };

      const response = controller.calculate(request);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Invalid operands: both operandA and operandB must be numbers');
    });

    it('should handle invalid operation type', () => {
      const request = {
        operandA: 10,
        operandB: 5,
        operation: 'invalid'
      };

      const response = controller.calculate(request);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid operation: invalid');
    });

    it('should handle division by zero through calculate', () => {
      const request = {
        operandA: 10,
        operandB: 0,
        operation: 'divide'
      };

      const response = controller.calculate(request);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Division by zero is not allowed');
    });
  });

  describe('specific operation endpoints', () => {
    it('should handle add endpoint', () => {
      const response = controller.add(7, 3);

      expect(response.success).toBe(true);
      expect(response.data?.result).toBe(10);
    });

    it('should handle subtract endpoint', () => {
      const response = controller.subtract(15, 8);

      expect(response.success).toBe(true);
      expect(response.data?.result).toBe(7);
    });

    it('should handle multiply endpoint', () => {
      const response = controller.multiply(4, 6);

      expect(response.success).toBe(true);
      expect(response.data?.result).toBe(24);
    });

    it('should handle divide endpoint', () => {
      const response = controller.divide(20, 4);

      expect(response.success).toBe(true);
      expect(response.data?.result).toBe(5);
    });

    it('should handle division by zero in divide endpoint', () => {
      const response = controller.divide(10, 0);

      expect(response.success).toBe(false);
      expect(response.error).toBe('Division by zero is not allowed');
    });
  });

  describe('history endpoints', () => {
    it('should get calculation history', () => {
      controller.add(1, 2);
      controller.multiply(3, 4);

      const response = controller.getHistory();

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(2);
      expect(response.data?.[0].result).toBe(3);
      expect(response.data?.[1].result).toBe(12);
    });

    it('should clear history', () => {
      controller.add(1, 1);
      
      const clearResponse = controller.clearHistory();
      expect(clearResponse.success).toBe(true);

      const historyResponse = controller.getHistory();
      expect(historyResponse.data).toHaveLength(0);
    });

    it('should get last result', () => {
      controller.multiply(5, 6);

      const response = controller.getLastResult();

      expect(response.success).toBe(true);
      expect(response.data?.result).toBe(30);
    });

    it('should return null for last result when no calculations', () => {
      const response = controller.getLastResult();

      expect(response.success).toBe(true);
      expect(response.data).toBeNull();
    });
  });

  describe('operation string mapping', () => {
    it('should handle various operation string formats', () => {
      const testCases = [
        { operation: 'add', expected: 8 },
        { operation: '+', expected: 8 },
        { operation: 'subtract', expected: 2 },
        { operation: '-', expected: 2 },
        { operation: 'multiply', expected: 15 },
        { operation: '*', expected: 15 },
        { operation: 'divide', expected: 1.6667 }
      ];

      testCases.forEach(({ operation, expected }) => {
        const request = {
          operandA: 5,
          operandB: 3,
          operation
        };

        const response = controller.calculate(request);

        expect(response.success).toBe(true);
        if (operation === 'divide') {
          expect(response.data?.result).toBeCloseTo(expected, 4);
        } else {
          expect(response.data?.result).toBe(expected);
        }
      });
    });

    it('should handle case insensitive operations', () => {
      const request = {
        operandA: 10,
        operandB: 2,
        operation: 'ADD'
      };

      const response = controller.calculate(request);

      expect(response.success).toBe(true);
      expect(response.data?.result).toBe(12);
    });
  });

  describe('error handling', () => {
    it('should handle calculator errors gracefully', () => {
      const request = {
        operandA: 10,
        operandB: 0,
        operation: 'divide'
      };

      const response = controller.calculate(request);

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.timestamp).toBeInstanceOf(Date);
    });
  });
});