<div class="max-w-md mx-auto bg-gray-900 rounded-lg shadow-2xl p-6 text-white"
     x-data="{
        handleKeydown(event) {
            const key = event.key;
            event.preventDefault();
            
            if (key >= '0' && key <= '9') {
                $wire.inputDigit(key);
            } else if (key === '.') {
                $wire.inputDecimal();
            } else if (key === '+') {
                $wire.inputOperator('+');
            } else if (key === '-') {
                $wire.inputOperator('-');
            } else if (key === '*') {
                $wire.inputOperator('×');
            } else if (key === '/') {
                $wire.inputOperator('÷');
            } else if (key === 'Enter' || key === '=') {
                $wire.calculate();
            } else if (key === 'Escape' || key === 'c' || key === 'C') {
                $wire.clear();
            } else if (key === 'Backspace') {
                $wire.backspace();
            } else if (key === '(') {
                $wire.inputParenthesis('(');
            } else if (key === ')') {
                $wire.inputParenthesis(')');
            }
        }
     }"
     x-on:keydown.window="handleKeydown($event)"
     tabindex="0">
    
    <!-- Display -->
    <div class="mb-4">
        <!-- Equation Display -->
        @if($equation)
        <div class="text-gray-400 text-sm text-right mb-1 h-5 overflow-hidden">
            {{ $equation }}
        </div>
        @else
        <div class="h-5 mb-1"></div>
        @endif
        
        <!-- Main Display -->
        <div class="bg-black rounded p-4 text-right">
            <div class="text-3xl font-mono {{ $hasError ? 'text-red-400' : 'text-white' }} break-all">
                {{ $display }}
            </div>
        </div>
    </div>

    <!-- Memory Indicator -->
    @if($memory != 0)
    <div class="text-xs text-blue-400 mb-2">
        M: {{ number_format($memory, 6) }}
    </div>
    @endif

    <!-- Calculator Buttons -->
    <div class="grid grid-cols-5 gap-2">
        <!-- Row 1: Memory and Clear functions -->
        <button wire:click="memoryClear" 
                class="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition-colors p-3 rounded text-sm font-semibold">
            MC
        </button>
        <button wire:click="memoryRecall" 
                class="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition-colors p-3 rounded text-sm font-semibold">
            MR
        </button>
        <button wire:click="memoryAdd" 
                class="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition-colors p-3 rounded text-sm font-semibold">
            M+
        </button>
        <button wire:click="memorySubtract" 
                class="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition-colors p-3 rounded text-sm font-semibold">
            M-
        </button>
        <button wire:click="clear" 
                class="bg-red-600 hover:bg-red-700 active:bg-red-800 transition-colors p-3 rounded font-semibold">
            C
        </button>

        <!-- Row 2: Advanced functions -->
        <button wire:click="inputFunction('sqrt')" 
                class="bg-purple-600 hover:bg-purple-700 active:bg-purple-800 transition-colors p-3 rounded text-sm font-semibold">
            √x
        </button>
        <button wire:click="inputFunction('cbrt')" 
                class="bg-purple-600 hover:bg-purple-700 active:bg-purple-800 transition-colors p-3 rounded text-sm font-semibold">
            ∛x
        </button>
        <button wire:click="inputFunction('square')" 
                class="bg-purple-600 hover:bg-purple-700 active:bg-purple-800 transition-colors p-3 rounded text-sm font-semibold">
            x²
        </button>
        <button wire:click="inputFunction('cube')" 
                class="bg-purple-600 hover:bg-purple-700 active:bg-purple-800 transition-colors p-3 rounded text-sm font-semibold">
            x³
        </button>
        <button wire:click="inputOperator('^')" 
                class="bg-purple-600 hover:bg-purple-700 active:bg-purple-800 transition-colors p-3 rounded text-sm font-semibold">
            xʸ
        </button>

        <!-- Row 3: More functions and parentheses -->
        <button wire:click="inputFunction('abs')" 
                class="bg-purple-600 hover:bg-purple-700 active:bg-purple-800 transition-colors p-3 rounded text-sm font-semibold">
            |x|
        </button>
        <button wire:click="inputFunction('percent')" 
                class="bg-purple-600 hover:bg-purple-700 active:bg-purple-800 transition-colors p-3 rounded text-sm font-semibold">
            %
        </button>
        <button wire:click="inputParenthesis('(')" 
                class="bg-gray-600 hover:bg-gray-700 active:bg-gray-800 transition-colors p-3 rounded font-semibold">
            (
        </button>
        <button wire:click="inputParenthesis(')')" 
                class="bg-gray-600 hover:bg-gray-700 active:bg-gray-800 transition-colors p-3 rounded font-semibold">
            )
        </button>
        <button wire:click="inputOperator('÷')" 
                class="bg-orange-600 hover:bg-orange-700 active:bg-orange-800 transition-colors p-3 rounded text-xl font-semibold">
            ÷
        </button>

        <!-- Row 4: Numbers and operations -->
        <button wire:click="inputDigit('7')" 
                class="bg-gray-700 hover:bg-gray-600 active:bg-gray-800 transition-colors p-4 rounded text-xl font-semibold">
            7
        </button>
        <button wire:click="inputDigit('8')" 
                class="bg-gray-700 hover:bg-gray-600 active:bg-gray-800 transition-colors p-4 rounded text-xl font-semibold">
            8
        </button>
        <button wire:click="inputDigit('9')" 
                class="bg-gray-700 hover:bg-gray-600 active:bg-gray-800 transition-colors p-4 rounded text-xl font-semibold">
            9
        </button>
        <button wire:click="inputOperator('×')" 
                class="bg-orange-600 hover:bg-orange-700 active:bg-orange-800 transition-colors p-4 rounded text-xl font-semibold">
            ×
        </button>
        <button wire:click="backspace" 
                class="bg-gray-600 hover:bg-gray-700 active:bg-gray-800 transition-colors p-4 rounded font-semibold">
            ⌫
        </button>

        <!-- Row 5: Numbers and operations -->
        <button wire:click="inputDigit('4')" 
                class="bg-gray-700 hover:bg-gray-600 active:bg-gray-800 transition-colors p-4 rounded text-xl font-semibold">
            4
        </button>
        <button wire:click="inputDigit('5')" 
                class="bg-gray-700 hover:bg-gray-600 active:bg-gray-800 transition-colors p-4 rounded text-xl font-semibold">
            5
        </button>
        <button wire:click="inputDigit('6')" 
                class="bg-gray-700 hover:bg-gray-600 active:bg-gray-800 transition-colors p-4 rounded text-xl font-semibold">
            6
        </button>
        <button wire:click="inputOperator('-')" 
                class="bg-orange-600 hover:bg-orange-700 active:bg-orange-800 transition-colors p-4 rounded text-xl font-semibold">
            -
        </button>
        <button wire:click="clearEntry" 
                class="bg-gray-600 hover:bg-gray-700 active:bg-gray-800 transition-colors p-4 rounded font-semibold">
            CE
        </button>

        <!-- Row 6: Numbers and operations -->
        <button wire:click="inputDigit('1')" 
                class="bg-gray-700 hover:bg-gray-600 active:bg-gray-800 transition-colors p-4 rounded text-xl font-semibold">
            1
        </button>
        <button wire:click="inputDigit('2')" 
                class="bg-gray-700 hover:bg-gray-600 active:bg-gray-800 transition-colors p-4 rounded text-xl font-semibold">
            2
        </button>
        <button wire:click="inputDigit('3')" 
                class="bg-gray-700 hover:bg-gray-600 active:bg-gray-800 transition-colors p-4 rounded text-xl font-semibold">
            3
        </button>
        <button wire:click="inputOperator('+')" 
                class="bg-orange-600 hover:bg-orange-700 active:bg-orange-800 transition-colors p-4 rounded text-xl font-semibold">
            +
        </button>
        <button wire:click="inputFunction('negate')" 
                class="bg-gray-600 hover:bg-gray-700 active:bg-gray-800 transition-colors p-4 rounded font-semibold">
            ±
        </button>

        <!-- Row 7: Zero, decimal, equals -->
        <button wire:click="inputDigit('0')" 
                class="bg-gray-700 hover:bg-gray-600 active:bg-gray-800 transition-colors p-4 rounded text-xl font-semibold col-span-2">
            0
        </button>
        <button wire:click="inputDecimal" 
                class="bg-gray-700 hover:bg-gray-600 active:bg-gray-800 transition-colors p-4 rounded text-xl font-semibold">
            .
        </button>
        <button wire:click="calculate" 
                class="bg-orange-600 hover:bg-orange-700 active:bg-orange-800 transition-colors p-4 rounded text-xl font-semibold col-span-2">
            =
        </button>
    </div>

    <!-- History Section -->
    @if(!empty($history))
    <div class="mt-6 border-t border-gray-700 pt-4">
        <div class="flex justify-between items-center mb-2">
            <h3 class="text-sm font-semibold text-gray-400">History</h3>
            <button wire:click="clearHistory" 
                    class="text-xs text-red-400 hover:text-red-300">
                Clear
            </button>
        </div>
        <div class="max-h-32 overflow-y-auto space-y-1">
            @foreach(array_slice($history, 0, 5) as $item)
            <div class="bg-gray-800 rounded p-2 text-xs">
                <div class="text-gray-400 mb-1">{{ $item['expression'] }}</div>
                <div class="flex justify-between">
                    <button wire:click="useHistoryResult({{ $item['result'] }})" 
                            class="text-white hover:text-blue-400 transition-colors text-right flex-1">
                        = {{ number_format($item['result'], 6) }}
                    </button>
                    <span class="text-gray-500 ml-2">{{ $item['timestamp'] }}</span>
                </div>
            </div>
            @endforeach
        </div>
    </div>
    @endif

    <!-- Keyboard Shortcuts Info -->
    <div class="mt-4 text-xs text-gray-500 text-center">
        Use keyboard: Numbers, +, -, *, /, Enter/=, Esc/C, Backspace, ( )
    </div>
</div>