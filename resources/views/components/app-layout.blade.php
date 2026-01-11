@props(['title' => config('app.name', 'RubiX Calc')])

<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" class="h-full">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="description" content="RubiX Calc - A powerful TALL stack calculator with 8th grade math features">
    <meta name="keywords" content="calculator, math, tall stack, livewire, alpinejs, tailwind">
    
    <title>{{ $title }}</title>

    <!-- Favicon -->
    <link rel="icon" type="image/x-icon" href="/favicon.ico">
    
    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=figtree:400,500,600&display=swap" rel="stylesheet" />

    <!-- PWA Meta Tags -->
    <meta name="theme-color" content="#1f2937">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="RubiX Calc">

    <!-- Scripts and Styles -->
    @vite(['resources/css/app.css', 'resources/js/app.js'])
    @livewireStyles
    
    <!-- Additional head content -->
    {{ $head ?? '' }}
</head>
<body class="font-sans antialiased h-full bg-gray-100 dark:bg-gray-900" x-data="globalKeyboard()">
    <div id="app" class="min-h-full">
        {{ $slot }}
    </div>

    @livewireScripts
    
    <!-- Additional scripts -->
    {{ $scripts ?? '' }}
</body>
</html>