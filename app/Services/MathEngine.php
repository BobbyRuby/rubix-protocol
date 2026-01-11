<?php

namespace App\Services;

class MathEngine
{
    private array $functions = [
        'sqrt' => 'sqrt',
        'cbrt' => 'cbrt',
        'abs' => 'abs',
        'pow' => 'pow',
    ];

    public function evaluate(string $expression): float
    {
        $expression = $this->sanitizeExpression($expression);
        
        if (empty($expression)) {
            return 0;
        }

        try {
            return $this->parseExpression($expression);
        } catch (\Exception $e) {
            throw new \InvalidArgumentException('Invalid mathematical expression');
        }
    }

    private function sanitizeExpression(string $expression): string
    {
        // Remove whitespace
        $expression = preg_replace('/\s+/', '', $expression);
        
        // Replace mathematical symbols
        $expression = str_replace(['×', '÷'], ['*', '/'], $expression);
        
        // Handle implicit multiplication (e.g., 2(3) -> 2*(3))
        $expression = preg_replace('/(\d)(\()/', '$1*$2', $expression);
        $expression = preg_replace('/(\))(\d)/', '$1*$2', $expression);
        $expression = preg_replace('/(\))(\()/', '$1*$2', $expression);
        
        return $expression;
    }

    private function parseExpression(string $expression): float
    {
        $tokens = $this->tokenize($expression);
        $postfix = $this->infixToPostfix($tokens);
        return $this->evaluatePostfix($postfix);
    }

    private function tokenize(string $expression): array
    {
        $tokens = [];
        $i = 0;
        $length = strlen($expression);

        while ($i < $length) {
            $char = $expression[$i];

            if (is_numeric($char) || $char === '.') {
                $number = '';
                while ($i < $length && (is_numeric($expression[$i]) || $expression[$i] === '.')) {
                    $number .= $expression[$i];
                    $i++;
                }
                $tokens[] = (float) $number;
                continue;
            }

            if (in_array($char, ['+', '-', '*', '/', '^', '(', ')'])) {
                $tokens[] = $char;
                $i++;
                continue;
            }

            // Handle function names
            if (ctype_alpha($char)) {
                $func = '';
                while ($i < $length && ctype_alpha($expression[$i])) {
                    $func .= $expression[$i];
                    $i++;
                }
                if (array_key_exists($func, $this->functions)) {
                    $tokens[] = $func;
                    continue;
                }
            }

            throw new \InvalidArgumentException("Invalid character: {$char}");
        }

        return $tokens;
    }

    private function infixToPostfix(array $tokens): array
    {
        $output = [];
        $operators = [];
        $precedence = ['+' => 1, '-' => 1, '*' => 2, '/' => 2, '^' => 3];
        $rightAssociative = ['^'];

        foreach ($tokens as $token) {
            if (is_numeric($token)) {
                $output[] = $token;
            } elseif (array_key_exists($token, $this->functions)) {
                $operators[] = $token;
            } elseif ($token === '(') {
                $operators[] = $token;
            } elseif ($token === ')') {
                while (!empty($operators) && end($operators) !== '(') {
                    $output[] = array_pop($operators);
                }
                if (empty($operators)) {
                    throw new \InvalidArgumentException('Mismatched parentheses');
                }
                array_pop($operators); // Remove '('
                
                // Pop function if present
                if (!empty($operators) && array_key_exists(end($operators), $this->functions)) {
                    $output[] = array_pop($operators);
                }
            } elseif (isset($precedence[$token])) {
                while (!empty($operators) && 
                       end($operators) !== '(' && 
                       (array_key_exists(end($operators), $this->functions) ||
                        (isset($precedence[end($operators)]) && 
                         ($precedence[end($operators)] > $precedence[$token] ||
                          ($precedence[end($operators)] === $precedence[$token] && 
                           !in_array($token, $rightAssociative)))))) {
                    $output[] = array_pop($operators);
                }
                $operators[] = $token;
            }
        }

        while (!empty($operators)) {
            $op = array_pop($operators);
            if ($op === '(' || $op === ')') {
                throw new \InvalidArgumentException('Mismatched parentheses');
            }
            $output[] = $op;
        }

        return $output;
    }

    private function evaluatePostfix(array $postfix): float
    {
        $stack = [];

        foreach ($postfix as $token) {
            if (is_numeric($token)) {
                $stack[] = $token;
            } elseif (in_array($token, ['+', '-', '*', '/', '^'])) {
                if (count($stack) < 2) {
                    throw new \InvalidArgumentException('Invalid expression');
                }
                $b = array_pop($stack);
                $a = array_pop($stack);
                $result = $this->applyOperator($token, $a, $b);
                $stack[] = $result;
            } elseif (array_key_exists($token, $this->functions)) {
                if (empty($stack)) {
                    throw new \InvalidArgumentException('Invalid expression');
                }
                $operand = array_pop($stack);
                $result = $this->applyFunction($token, $operand);
                $stack[] = $result;
            }
        }

        if (count($stack) !== 1) {
            throw new \InvalidArgumentException('Invalid expression');
        }

        return $stack[0];
    }

    private function applyOperator(string $operator, float $a, float $b): float
    {
        switch ($operator) {
            case '+':
                return $a + $b;
            case '-':
                return $a - $b;
            case '*':
                return $a * $b;
            case '/':
                if ($b == 0) {
                    throw new \InvalidArgumentException('Division by zero');
                }
                return $a / $b;
            case '^':
                return pow($a, $b);
            default:
                throw new \InvalidArgumentException("Unknown operator: {$operator}");
        }
    }

    private function applyFunction(string $function, float $operand): float
    {
        switch ($function) {
            case 'sqrt':
                if ($operand < 0) {
                    throw new \InvalidArgumentException('Cannot calculate square root of negative number');
                }
                return sqrt($operand);
            case 'cbrt':
                return pow($operand, 1/3);
            case 'abs':
                return abs($operand);
            default:
                throw new \InvalidArgumentException("Unknown function: {$function}");
        }
    }
}