# Eighth Grade Calculator

A basic calculator application built with the TALL stack (Tailwind CSS, Alpine.js, Laravel, Livewire) with SQLite persistence.

## Installation

1. Navigate to D: drive and create the project:
```bash
cd D:\
composer create-project laravel/laravel calculator
cd calculator
```

2. Install required packages:
```bash
composer require livewire/livewire
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

3. Copy the files from this template into your project

4. Configure database in .env:
```
DB_CONNECTION=sqlite
DB_DATABASE=D:/calculator/database/database.sqlite
```

5. Create SQLite database:
```bash
touch database/database.sqlite
php artisan migrate
```

6. Build assets and run:
```bash
npm run build
php artisan serve
```

## Features
- Basic arithmetic: +, -, ×, ÷
- Percentage calculations
- Square root
- Exponents (powers)
- Calculation history saved to SQLite
- Clear history function
- Responsive design