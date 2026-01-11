<?php

namespace App\Livewire;

use App\Services\MathEngine;
use Livewire\Component;

class Calculator extends Component
{
    public string $display = '0';
    public string $equation = '';
    public array $history = [];
    public float $memory = 0;
    public bool $hasError = false;
    public bool $shouldClearDisplay = false;

    private MathEngine $mathEngine;

    public function boot()
    {
        $this->mathEngine = new MathEngine();
    }

    public function mount()
    {
        $this->history = session('calculator_history', []);
        $this->memory = session('calculator_memory', 0);
    }

    public function inputDigit(string $digit)
    {
        if ($this->hasError) {
            $this->clear();
        }

        if ($this->shouldClearDisplay) {
            $this->display = '';
            $this->shouldClearDisplay = false;
        }

        if ($this->display === '0' && $digit !== '.') {
            $this->display = $digit;
        } else {
            $this->display .= $digit;
        }
    }

    public function inputDecimal()
    {
        if ($this->hasError) {
            $this->clear();
        }

        if ($this->shouldClearDisplay) {
            $this->display = '0';
            $this->shouldClearDisplay = false;
        }

        if (!str_contains($this->display, '.')) {
            $this->display .= '.';
        }
    }

    public function inputOperator(string $operator)
    {
        if ($this->hasError) {
            $this->clear();
        }

        $this->shouldClearDisplay = true;
        
        if (empty($this->equation)) {
            $this->equation = $this->display . ' ' . $operator . ' ';
        } else {
            // If equation ends with an operator, replace it
            if (preg_match('/[\+\-\×\÷]\s*$/', $this->equation)) {
                $this->equation = rtrim($this->equation);
                $this->equation = preg_replace('/[\+\-\×\÷]\s*$/', ' ' . $operator . ' ', $this->equation);
            } else {
                $this->equation .= $this->display . ' ' . $operator . ' ';
            }
        }
    }

    public function inputFunction(string $function)
    {
        if ($this->hasError) {
            $this->clear();
        }

        try {
            $value = (float) $this->display;
            
            switch ($function) {
                case 'sqrt':
                    if ($value < 0) {
                        throw new \InvalidArgumentException('Cannot calculate square root of negative number');
                    }
                    $result = sqrt($value);
                    break;
                case 'cbrt':
                    $result = pow($value, 1/3);
                    break;
                case 'square':
                    $result = pow($value, 2);
                    break;
                case 'cube':
                    $result = pow($value, 3);
                    break;
                case 'abs':
                    $result = abs($value);
                    break;
                case 'percent':
                    $result = $value / 100;
                    break;
                case 'negate':
                    $result = -$value;
                    break;
                default:
                    throw new \InvalidArgumentException('Unknown function');
            }

            $this->addToHistory($function . '(' . $value . ')', $result);
            $this->display = $this->formatResult($result);
            $this->equation = '';
            $this->shouldClearDisplay = true;
        } catch (\Exception $e) {
            $this->showError();
        }
    }

    public function inputParenthesis(string $paren)
    {
        if ($this->hasError) {
            $this->clear();
        }

        if ($this->shouldClearDisplay && $paren === '(') {
            $this->display = '';
            $this->shouldClearDisplay = false;
        }

        if (empty($this->equation)) {
            if ($paren === '(') {
                $this->equation = '(';
                $this->display = '';
            }
        } else {
            $this->equation .= $paren;
            if ($paren === '(') {
                $this->display = '';
            }
        }
    }

    public function calculate()
    {
        if ($this->hasError) {
            return;
        }

        try {
            $expression = $this->equation . $this->display;
            
            if (empty($expression) || $expression === '0') {
                return;
            }

            $result = $this->mathEngine->evaluate($expression);
            
            $this->addToHistory($expression, $result);
            $this->display = $this->formatResult($result);
            $this->equation = '';
            $this->shouldClearDisplay = true;
        } catch (\Exception $e) {
            $this->showError();
        }
    }

    public function clear()
    {
        $this->display = '0';
        $this->equation = '';
        $this->hasError = false;
        $this->shouldClearDisplay = false;
    }

    public function clearEntry()
    {
        $this->display = '0';
        $this->hasError = false;
    }

    public function backspace()
    {
        if ($this->hasError) {
            $this->clear();
            return;
        }

        if (strlen($this->display) > 1) {
            $this->display = substr($this->display, 0, -1);
        } else {
            $this->display = '0';
        }
    }

    public function memoryAdd()
    {
        $value = (float) $this->display;
        $this->memory += $value;
        $this->saveMemory();
    }

    public function memorySubtract()
    {
        $value = (float) $this->display;
        $this->memory -= $value;
        $this->saveMemory();
    }

    public function memoryRecall()
    {
        $this->display = $this->formatResult($this->memory);
        $this->shouldClearDisplay = true;
    }

    public function memoryClear()
    {
        $this->memory = 0;
        $this->saveMemory();
    }

    public function clearHistory()
    {
        $this->history = [];
        session(['calculator_history' => []]);
    }

    public function useHistoryResult(float $result)
    {
        $this->display = $this->formatResult($result);
        $this->equation = '';
        $this->shouldClearDisplay = true;
    }

    private function addToHistory(string $expression, float $result)
    {
        $historyItem = [
            'expression' => $expression,
            'result' => $result,
            'timestamp' => now()->format('H:i:s')
        ];

        array_unshift($this->history, $historyItem);
        
        // Keep only last 20 calculations
        $this->history = array_slice($this->history, 0, 20);
        
        session(['calculator_history' => $this->history]);
    }

    private function saveMemory()
    {
        session(['calculator_memory' => $this->memory]);
    }

    private function showError()
    {
        $this->display = 'Error';
        $this->equation = '';
        $this->hasError = true;
    }

    private function formatResult(float $result): string
    {
        // Handle very large or very small numbers
        if (abs($result) >= 1e10 || (abs($result) < 1e-6 && $result != 0)) {
            return sprintf('%.6e', $result);
        }

        // Remove unnecessary trailing zeros
        $formatted = number_format($result, 10);
        $formatted = rtrim($formatted, '0');
        $formatted = rtrim($formatted, '.');
        
        return $formatted;
    }

    public function render()
    {
        return view('livewire.calculator');
    }
}