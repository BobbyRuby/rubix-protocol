<?php

namespace App\Livewire;

use App\Services\CalculatorService;
use App\Models\Calculation;
use Livewire\Component;
use DivisionByZeroError;
use InvalidArgumentException;

class Calculator extends Component
{
    public string $display = '0';
    public string $expression = '';
    public ?string $operator = null;
    public ?float $firstOperand = null;
    public bool $newInput = true;
    public ?string $error = null;

    protected CalculatorService $calculator;

    public function boot(CalculatorService $calculator): void
    {
        $this->calculator = $calculator;
    }

    public function inputNumber(string $number): void
    {
        $this->error = null;
        
        if ($this->newInput) {
            $this->display = $number;
            $this->newInput = false;
        } else {
            if ($this->display === '0' && $number !== '.') {
                $this->display = $number;
            } else {
                if (strlen($this->display) < 15) {
                    $this->display .= $number;
                }
            }
        }
    }

    public function inputDecimal(): void
    {
        $this->error = null;
        
        if ($this->newInput) {
            $this->display = '0.';
            $this->newInput = false;
            return;
        }
        
        if (!str_contains($this->display, '.')) {
            $this->display .= '.';
        }
    }

    public function inputOperator(string $op): void
    {
        $this->error = null;
        
        if ($this->firstOperand !== null && $this->operator !== null && !$this->newInput) {
            $this->performCalculation();
        }
        
        $this->firstOperand = (float) $this->display;
        $this->operator = $op;
        $this->expression = $this->display . ' ' . $op;
        $this->newInput = true;
    }

    public function calculate(): void
    {
        if ($this->firstOperand === null || $this->operator === null) {
            return;
        }

        $this->performCalculation();
        $this->operator = null;
        $this->firstOperand = null;
        $this->expression = '';
    }

    protected function performCalculation(): void
    {
        try {
            $secondOperand = (float) $this->display;
            
            $result = match ($this->operator) {
                '+' => $this->firstOperand + $secondOperand,
                '−', '-' => $this->firstOperand - $secondOperand,
                '×', '*' => $this->firstOperand * $secondOperand,
                '÷', '/' => $this->divideNumbers($this->firstOperand, $secondOperand),
                default => throw new InvalidArgumentException("Unknown operator"),
            };

            $expressionStr = "{$this->firstOperand} {$this->operator} {$secondOperand}";
            
            Calculation::store(
                $expressionStr,
                $result,
                $this->firstOperand,
                $this->operator,
                $secondOperand
            );

            $this->display = $this->formatNumber($result);
            $this->firstOperand = $result;
            $this->newInput = true;
            
        } catch (DivisionByZeroError $e) {
            $this->error = "Cannot divide by zero!";
            $this->display = '0';
            $this->newInput = true;
        } catch (\Throwable $e) {
            $this->error = "Calculation error";
            $this->display = '0';
            $this->newInput = true;
        }
    }

    protected function divideNumbers(float $a, float $b): float
    {
        if ($b == 0) {
            throw new DivisionByZeroError();
        }
        return $a / $b;
    }

    public function percentage(): void
    {
        $this->error = null;
        
        try {
            $value = (float) $this->display;
            
            if ($this->firstOperand !== null) {
                $result = $this->firstOperand * ($value / 100);
            } else {
                $result = $value / 100;
            }
            
            Calculation::store(
                "{$value}%",
                $result,
                $value,
                '%',
                null,
                'percentage'
            );
            
            $this->display = $this->formatNumber($result);
            $this->newInput = true;
        } catch (\Throwable $e) {
            $this->error = "Error calculating percentage";
        }
    }

    public function squareRoot(): void
    {
        $this->error = null;
        
        try {
            $value = (float) $this->display;
            
            if ($value < 0) {
                $this->error = "Cannot find √ of negative number!";
                return;
            }
            
            $result = sqrt($value);
            
            Calculation::store(
                "√{$value}",
                $result,
                $value,
                null,
                null,
                'square_root'
            );
            
            $this->display = $this->formatNumber($result);
            $this->expression = "√{$value}";
            $this->newInput = true;
        } catch (\Throwable $e) {
            $this->error = "Error calculating square root";
        }
    }

    public function power(): void
    {
        $this->error = null;
        
        try {
            $value = (float) $this->display;
            $result = $value * $value;
            
            Calculation::store(
                "{$value}²",
                $result,
                $value,
                null,
                null,
                'square'
            );
            
            $this->display = $this->formatNumber($result);
            $this->expression = "{$value}²";
            $this->newInput = true;
        } catch (\Throwable $e) {
            $this->error = "Error calculating power";
        }
    }

    public function toggleSign(): void
    {
        $this->error = null;
        $value = (float) $this->display;
        $this->display = $this->formatNumber($value * -1);
    }

    public function clear(): void
    {
        $this->display = '0';
        $this->expression = '';
        $this->operator = null;
        $this->firstOperand = null;
        $this->newInput = true;
        $this->error = null;
    }

    public function clearEntry(): void
    {
        $this->display = '0';
        $this->newInput = true;
        $this->error = null;
    }

    public function clearHistory(): void
    {
        Calculation::truncate();
    }

    public function loadFromHistory(int $id): void
    {
        $calculation = Calculation::find($id);
        
        if ($calculation) {
            $this->display = $this->formatNumber($calculation->result);
            $this->expression = $calculation->expression;
            $this->newInput = true;
        }
    }

    protected function formatNumber(float $number): string
    {
        if (is_infinite($number) || is_nan($number)) {
            return 'Error';
        }
        
        if (floor($number) == $number && abs($number) < 1e10) {
            return (string) (int) $number;
        }
        
        $formatted = rtrim(rtrim(number_format($number, 10, '.', ''), '0'), '.');
        
        if (strlen($formatted) > 15) {
            return sprintf('%.6e', $number);
        }
        
        return $formatted;
    }

    public function render()
    {
        return view('livewire.calculator', [
            'history' => Calculation::recent(15)->get(),
        ]);
    }
}