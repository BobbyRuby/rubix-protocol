<div class="flex flex-col lg:flex-row gap-8 items-start justify-center">
    {{-- Main Calculator --}}
    <div class="bg-calculator-bg/80 backdrop-blur-sm rounded-3xl p-6 shadow-2xl border border-calculator-button/30">
        {{-- Display --}}
        <div class="calc-display">
            <div class="text-gray-400 text-sm h-6 text-right overflow-hidden">
                {{ $expression ?: '&nbsp;' }}
            </div>
            <div class="text-white text-4xl font-mono text-right overflow-x-auto">
                {{ $display ?: '0' }}
            </div>
            @if($error)
                <div class="text-red-400 text-sm mt-1">{{ $error }}</div>
            @endif
        </div>

        {{-- Function Buttons Row --}}
        <div class="grid grid-cols-5 gap-2 mb-2">
            <button wire:click="clear" class="calc-button-clear">C</button>
            <button wire:click="clearEntry" class="calc-button-clear">CE</button>
            <button wire:click="percentage" class="calc-button-function">%</button>
            <button wire:click="squareRoot" class="calc-button-function">√</button>
            <button wire:click="power" class="calc-button-function">x²</button>
        </div>

        {{-- Number Pad and Operators --}}
        <div class="grid grid-cols-4 gap-2">
            {{-- Row 1 --}}
            <button wire:click="inputNumber('7')" class="calc-button-number">7</button>
            <button wire:click="inputNumber('8')" class="calc-button-number">8</button>
            <button wire:click="inputNumber('9')" class="calc-button-number">9</button>
            <button wire:click="inputOperator('÷')" class="calc-button-operator">÷</button>
            
            {{-- Row 2 --}}
            <button wire:click="inputNumber('4')" class="calc-button-number">4</button>
            <button wire:click="inputNumber('5')" class="calc-button-number">5</button>
            <button wire:click="inputNumber('6')" class="calc-button-number">6</button>
            <button wire:click="inputOperator('×')" class="calc-button-operator">×</button>
            
            {{-- Row 3 --}}
            <button wire:click="inputNumber('1')" class="calc-button-number">1</button>
            <button wire:click="inputNumber('2')" class="calc-button-number">2</button>
            <button wire:click="inputNumber('3')" class="calc-button-number">3</button>
            <button wire:click="inputOperator('-')" class="calc-button-operator">−</button>
            
            {{-- Row 4 --}}
            <button wire:click="toggleSign" class="calc-button-function">±</button>
            <button wire:click="inputNumber('0')" class="calc-button-number">0</button>
            <button wire:click="inputDecimal" class="calc-button-number">.</button>
            <button wire:click="inputOperator('+')" class="calc-button-operator">+</button>
            
            {{-- Row 5 - Equals --}}
            <button wire:click="calculate" class="calc-button-equals col-span-4">
                =
            </button>
        </div>

        {{-- Quick Reference for 8th Graders --}}
        <div class="mt-4 p-3 bg-calculator-button/30 rounded-lg text-xs text-gray-400">
            <p class="font-semibold text-gray-300 mb-1">💡 Quick Tips:</p>
            <ul class="space-y-1">
                <li><span class="text-calculator-function">√</span> = Square Root (√16 = 4)</li>
                <li><span class="text-calculator-function">x²</span> = Square a number (5² = 25)</li>
                <li><span class="text-calculator-function">%</span> = Percent (50% of 200 = 100)</li>
            </ul>
        </div>
    </div>

    {{-- History Panel --}}
    <div class="bg-calculator-bg/80 backdrop-blur-sm rounded-3xl p-6 shadow-2xl border border-calculator-button/30 w-80">
        <div class="flex justify-between items-center mb-4">
            <h2 class="text-white text-lg font-semibold">📜 History</h2>
            <button wire:click="clearHistory" class="text-gray-400 hover:text-red-400 text-sm transition-colors">
                Clear All
            </button>
        </div>

        <div class="max-h-96 overflow-y-auto">
            @forelse($history as $item)
                <div class="history-item cursor-pointer" wire:click="loadFromHistory({{ $item->id }})">
                    <div class="text-gray-400 text-xs">{{ $item->created_at->format('h:i A') }}</div>
                    <div class="text-white font-mono">{{ $item->expression }}</div>
                    <div class="text-calculator-equals font-semibold">= {{ $item->result }}</div>
                </div>
            @empty
                <p class="text-gray-500 text-center py-8">No calculations yet!</p>
            @endforelse
        </div>
    </div>
</div>