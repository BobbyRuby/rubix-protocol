import defaultTheme from 'tailwindcss/defaultTheme';

/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './vendor/laravel/framework/src/Illuminate/Pagination/resources/views/*.blade.php',
        './storage/framework/views/*.php',
        './resources/views/**/*.blade.php',
    ],

    theme: {
        extend: {
            fontFamily: {
                sans: ['Figtree', ...defaultTheme.fontFamily.sans],
            },
            animation: {
                'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            },
            colors: {
                calculator: {
                    display: '#000000',
                    background: '#1a1a1a',
                    button: {
                        number: '#404040',
                        operator: '#ff9500',
                        function: '#505050',
                        clear: '#a6a6a6',
                    }
                }
            },
            gridTemplateColumns: {
                'calculator': 'repeat(5, 1fr)',
            },
            screens: {
                'xs': '475px',
            },
        },
    },

    plugins: [],
};