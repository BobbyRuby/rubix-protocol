<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">

        <title>Rubix Calculator</title>

        <!-- Fonts -->
        <link rel="preconnect" href="https://fonts.bunny.net">
        <link href="https://fonts.bunny.net/css?family=figtree:400,500,600&display=swap" rel="stylesheet" />

        <!-- Styles / Scripts -->
        @vite(['resources/css/app.css', 'resources/js/app.js'])
    </head>
    <body class="font-sans antialiased dark:bg-black dark:text-white/50">
        <div class="bg-gradient-to-br from-gray-900 via-purple-900 to-violet-900 min-h-screen">
            <div class="relative min-h-screen flex flex-col items-center justify-center selection:bg-[#FF2D20] selection:text-white">
                <div class="relative w-full max-w-2xl px-6 lg:max-w-7xl">
                    <header class="text-center mb-8">
                        <h1 class="text-4xl font-bold text-white mb-2">Rubix Calculator</h1>
                        <p class="text-gray-300">A powerful TALL stack calculator with advanced mathematical functions</p>
                    </header>

                    <main class="flex justify-center">
                        @livewire('calculator')
                    </main>

                    <footer class="mt-8 text-center text-gray-400 text-sm">
                        <p>Built with Laravel + Livewire + Alpine.js + Tailwind CSS</p>
                        <p class="mt-2">Features: Basic operations, advanced math, memory functions, history, and keyboard support</p>
                    </footer>
                </div>
            </div>
        </div>
    </body>
</html>