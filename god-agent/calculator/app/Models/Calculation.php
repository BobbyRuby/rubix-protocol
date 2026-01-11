<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class Calculation extends Model
{
    use HasFactory;

    protected $fillable = [
        'expression',
        'first_operand',
        'operator',
        'second_operand',
        'result',
        'operation_type',
    ];

    protected $casts = [
        'first_operand' => 'float',
        'second_operand' => 'float',
        'result' => 'float',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function scopeRecent($query, int $limit = 20)
    {
        return $query->orderBy('created_at', 'desc')->limit($limit);
    }

    public static function store(
        string $expression,
        float $result,
        ?float $firstOperand = null,
        ?string $operator = null,
        ?float $secondOperand = null,
        string $operationType = 'basic'
    ): self {
        return self::create([
            'expression' => $expression,
            'first_operand' => $firstOperand,
            'operator' => $operator,
            'second_operand' => $secondOperand,
            'result' => $result,
            'operation_type' => $operationType,
        ]);
    }
}