<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Blade;
use App\Services\MathEngine;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(MathEngine::class, function ($app) {
            return new MathEngine();
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Register Blade components
        Blade::component('app-layout', \App\View\Components\AppLayout::class);
        
        // Set default session configuration for calculator
        config(['session.lifetime' => 120]); // 2 hours
    }
}