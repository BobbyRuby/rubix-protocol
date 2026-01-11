import './bootstrap';
import { Livewire } from '../../vendor/livewire/livewire/dist/livewire.esm';
import Alpine from 'alpinejs';

// Initialize Alpine.js
window.Alpine = Alpine;

// Add global Alpine data for calculator keyboard handling
Alpine.data('calculator', () => ({
    init() {
        // Focus the calculator container for keyboard events
        this.$el.focus();
    },
    
    handleKeyPress(event) {
        // Prevent default browser behavior for calculator keys
        const calculatorKeys = ['0','1','2','3','4','5','6','7','8','9','+','-','*','/','=','Enter','Escape','Backspace','.','(',')','^'];
        if (calculatorKeys.includes(event.key)) {
            event.preventDefault();
        }
    },
    
    formatDisplayNumber(number) {
        // Format large numbers with scientific notation
        if (Math.abs(number) >= 1e10) {
            return number.toExponential(6);
        }
        return number.toString();
    }
}));

// Start Alpine and Livewire
Alpine.start();
Livewire.start();

// Add global keyboard event listener for calculator
document.addEventListener('DOMContentLoaded', function() {
    // Add visual feedback for button presses
    document.addEventListener('click', function(e) {
        if (e.target.matches('button')) {
            e.target.classList.add('button-pressed');
            setTimeout(() => {
                e.target.classList.remove('button-pressed');
            }, 100);
        }
    });
    
    // Add haptic feedback for mobile devices
    if ('vibrate' in navigator) {
        document.addEventListener('click', function(e) {
            if (e.target.matches('button')) {
                navigator.vibrate(50);
            }
        });
    }
});