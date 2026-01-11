<?php

namespace App\Services;

use App\Models\Calculation;
use InvalidArgumentException;
use DivisionByZeroError;

class CalculatorService
{
    public function add(float $a, float $b): float
    {
        $result = $a + $b;
        $this->saveCalculation("{$a} + {$b}", $result, $a, '+', $b);
        return $result;
    }

    public function subtract(float $a, float $b): float
    {
        $result = $a - $b;
        $this->saveCalculation("{$a} - {$b}", $result, $a, '-', $b);
        return $result;
    }

    public function multiply(float $a, float $b): float
    {
        $result = $a * $b;
        $this->saveCalculation("{$a} × {$b}", $result, $a, '×', $b);
        return $result;
    }

    public function divide(float $a, float $b): float
    {
        if ($b == 0) {
            throw new DivisionByZeroError('Cannot divide by zero');
        }
        $result = $a / $b;
        $this->saveCalculation("{$a} ÷ {$b}", $result, $a, '÷', $b);
        return $result;
    }

    public function percentage(float $value, float $percent): float
    {
        $result = ($value * $percent) / 100;
        $this->saveCalculation("{$percent}% of {$value}", $result, $value, '%', $percent, 'percentage');
        return $result;
    }

    public function squareRoot(float $value): float
    {
        if ($value < 0) {
            throw new InvalidArgumentException('Cannot calculate square root of negative number');
        }
        $result = sqrt($value);
        $this->saveCalculation("√{$value}", $result, $value, null, null, 'square_root');
        return $result;
    }

    public function power(float $base, float $exponent): float
    {
        $result = pow($base, $exponent);
        $this->saveCalculation("{$base}^{$exponent}", $result, $base, '^', $exponent, 'power');
        return $result;
    }

    public function square(float $value): float
    {
        $result = $value * $value;
        $this->saveCalculation("{$value}²", $result, $value, null, null, 'square');
        return $result;
    }

    public function calculate(float $a, string $operator, float $b): float
    {
        return match ($operator) {
            '+' => $this->add($a, $b),
            '-', '−' => $this->subtract($a, $b),
            '*', '×' => $this->multiply($a, $b),
            '/', '÷' => $this->divide($a, $b),
            '^' => $this->power($a, $b),
            '%' => $this->percentage($a, $b),
            default => throw new InvalidArgumentException("Unknown operator: {$operator}"),
        };
    }

    public function formatResult(float $result): string
    {
        if (floor($result) == $result && abs($result) < 1e10) {
            return number_format($result, 0);
        }
        
        $formatted = number_format($result, 10);
        $formatted = rtrim($formatted, '0');
        $formatted = rtrim($formatted, '.');
        
        return $formatted;
    }

    protected function saveCalculation(
        string $expression,
        float $result,
        ?float $firstOperand = null,
        ?string $operator = null,
        ?float $secondOperand = null,
        string $operationType = 'basic'
    ): Calculation {
        return Calculation::store(
            $expression,
            $result,
            $firstOperand,
            $operator,
            $secondOperand,
            $operationType
        );
    }

    public function getHistory(int $limit = 20): \Illuminate\Database\Eloquent\Collection
    {
        return Calculation::recent($limit)->get();
    }

    public function clearHistory(): void
    {
        Calculation::truncate();
    }
}