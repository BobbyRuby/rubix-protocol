<?php

namespace App\Http\Livewire;

use App\Services\MathEngine;
use Livewire\Component;

class Calculator extends Component
{
    public string $display = '0';
    public string $equation = '';
    public array $history = [];
    public bool $justCalculated = false;
    public bool $darkMode = true;
    
    private MathEngine $mathEngine;
    
    public function boot()
    {
        $this->mathEngine = new MathEngine();
        $this->history = session('calc_history', []);
    }
    
    public function mount()
    {
        $this->darkMode = session('dark_mode', true);
    }
    
    public function inputNumber(string $number): void
    {
        if ($this->justCalculated) {
            $this->display = $number;
            $this->equation = $number;
            $this->justCalculated = false;
        } else {
            if ($this->display === '0') {
                $this->display = $number;
                $this->equation = $number;
            } else {
                $this->display .= $number;
                $this->equation .= $number;
            }
        }
    }
    
    public function inputDecimal(): void
    {
        if ($this->justCalculated) {
            $this->display = '0.';
            $this->equation = '0.';
            $this->justCalculated = false;
            return;
        }
        
        $lastNumber = $this->getLastNumber();
        if (!str_contains($lastNumber, '.')) {
            $this->display .= '.';
            $this->equation .= '.';
        }
    }
    
    public function inputOperator(string $operator): void
    {
        if ($this->justCalculated) {
            $this->equation = $this->display . $operator;
            $this->justCalculated = false;
        } else {
            $this->equation .= $operator;
        }
        
        $this->display = $this->equation;
    }
    
    public function inputFunction(string $function): void
    {
        if ($this->justCalculated) {
            $this->equation = $function . '(';
            $this->justCalculated = false;
        } else {
            $this->equation .= $function . '(';
        }
        
        $this->display = $this->equation;
    }
    
    public function square(): void
    {
        if ($this->display !== '0') {
            $number = (float) $this->display;
            $result = $number * $number;
            $this->addToHistory($this->display . '²', $result);
            $this->display = (string) $result;
            $this->equation = (string) $result;
            $this->justCalculated = true;
        }
    }
    
    public function cube(): void
    {
        if ($this->display !== '0') {
            $number = (float) $this->display;
            $result = $number * $number * $number;
            $this->addToHistory($this->display . '³', $result);
            $this->display = (string) $result;
            $this->equation = (string) $result;
            $this->justCalculated = true;
        }
    }
    
    public function power(): void
    {
        $this->inputOperator('^');
    }
    
    public function squareRoot(): void
    {
        if ($this->display !== '0') {
            $number = (float) $this->display;
            if ($number < 0) {
                $this->display = 'Error';
                return;
            }
            $result = sqrt($number);
            $this->addToHistory('√(' . $this->display . ')', $result);
            $this->display = (string) $result;
            $this->equation = (string) $result;
            $this->justCalculated = true;
        }
    }
    
    public function cubeRoot(): void
    {
        if ($this->display !== '0') {
            $number = (float) $this->display;
            $result = pow($number, 1/3);
            $this->addToHistory('∛(' . $this->display . ')', $result);
            $this->display = (string) $result;
            $this->equation = (string) $result;
            $this->justCalculated = true;
        }
    }
    
    public function absolute(): void
    {
        if ($this->display !== '0') {
            $number = (float) $this->display;
            $result = abs($number);
            $this->addToHistory('|' . $this->display . '|', $result);
            $this->display = (string) $result;
            $this->equation = (string) $result;
            $this->justCalculated = true;
        }
    }
    
    public function percentage(): void
    {
        if ($this->display !== '0') {
            $number = (float) $this->display;
            $result = $number / 100;
            $this->addToHistory($this->display . '%', $result);
            $this->display = (string) $result;
            $this->equation = (string) $result;
            $this->justCalculated = true;
        }
    }
    
    public function negate(): void
    {
        if ($this->display !== '0') {
            if (str_starts_with($this->display, '-')) {
                $this->display = substr($this->display, 1);
            } else {
                $this->display = '-' . $this->display;
            }
            
            if ($this->justCalculated) {
                $this->equation = $this->display;
            }
        }
    }
    
    public function memoryAdd(): void
    {
        $value = (float) $this->display;
        $this->mathEngine->memoryAdd($value);
        session(['memory_value' => $this->mathEngine->memoryRecall()]);
    }
    
    public function memorySubtract(): void
    {
        $value = (float) $this->display;
        $this->mathEngine->memorySubtract($value);
        session(['memory_value' => $this->mathEngine->memoryRecall()]);
    }
    
    public function memoryRecall(): void
    {
        $memoryValue = session('memory_value', 0);
        $this->display = (string) $memoryValue;
        $this->equation = (string) $memoryValue;
        $this->justCalculated = true;
    }
    
    public function memoryClear(): void
    {
        $this->mathEngine->memoryClear();
        session(['memory_value' => 0]);
    }
    
    public function calculate(): void
    {
        if (empty($this->equation)) return;
        
        $result = $this->mathEngine->evaluate($this->equation);
        
        if ($result === 'Error') {
            $this->display = 'Error';
            return;
        }
        
        $this->addToHistory($this->equation, $result);
        $this->display = $this->formatNumber($result);
        $this->equation = $this->display;
        $this->justCalculated = true;
    }
    
    public function clear(): void
    {
        $this->display = '0';
        $this->equation = '';
        $this->justCalculated = false;
    }
    
    public function backspace(): void
    {
        if (strlen($this->display) > 1) {
            $this->display = substr($this->display, 0, -1);
            $this->equation = substr($this->equation, 0, -1);
        } else {
            $this->display = '0';
            $this->equation = '';
        }
    }
    
    public function clearHistory(): void
    {
        $this->history = [];
        session(['calc_history' => []]);
    }
    
    public function useHistoryItem(string $result): void
    {
        $this->display = $result;
        $this->equation = $result;
        $this->justCalculated = true;
    }
    
    public function toggleDarkMode(): void
    {
        $this->darkMode = !$this->darkMode;
        session(['dark_mode' => $this->darkMode]);
    }
    
    private function getLastNumber(): string
    {
        $matches = [];
        preg_match('/([0-9.]+)$/', $this->equation, $matches);
        return $matches[0] ?? '';
    }
    
    private function addToHistory(string $expression, float $result): void
    {
        $historyItem = [
            'expression' => $expression,
            'result' => $this->formatNumber($result),
            'timestamp' => now()->format('H:i:s')
        ];
        
        array_unshift($this->history, $historyItem);
        
        // Keep only last 10 calculations
        $this->history = array_slice($this->history, 0, 10);
        
        session(['calc_history' => $this->history]);
    }
    
    private function formatNumber(float $number): string
    {
        if (abs($number) >= 1e10 || (abs($number) < 1e-6 && $number != 0)) {
            return sprintf('%.3e', $number);
        }
        
        $formatted = rtrim(rtrim(sprintf('%.10f', $number), '0'), '.');
        return $formatted === '' ? '0' : $formatted;
    }
    
    public function render()
    {
        return view('livewire.calculator');
    }
}