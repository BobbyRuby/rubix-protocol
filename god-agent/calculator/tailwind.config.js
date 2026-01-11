/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./resources/**/*.blade.php",
        "./resources/**/*.js",
        "./app/Livewire/**/*.php",
    ],
    theme: {
        extend: {
            colors: {
                calculator: {
                    bg: '#1a1a2e',
                    display: '#16213e',
                    button: '#0f3460',
                    operator: '#e94560',
                    equals: '#00d9ff',
                    number: '#533483',
                    function: '#7952b3',
                }
            }
        },
    },
    plugins: [],
}