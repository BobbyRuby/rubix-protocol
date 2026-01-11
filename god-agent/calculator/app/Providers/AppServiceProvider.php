<?php

namespace App\Providers;

use App\Services\CalculatorService;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(CalculatorService::class, function ($app) {
            return new CalculatorService();
        });
    }

    public function boot(): void
    {
        //
    }
}