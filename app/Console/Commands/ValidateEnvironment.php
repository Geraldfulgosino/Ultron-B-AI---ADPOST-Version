<?php

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;

class ValidateEnvironment extends Command
{
    protected $signature = 'ultron:env:validate';

    protected $description = 'Validate environment variables for production readiness';

    public function handle(): int
    {
        $isProduction = config('app.env') === 'production';

        if (! $isProduction) {
            $this->warn('Running in non-production environment. Checks are advisory only.');
        }

        $failures = 0;

        $failures += $this->check(
            'APP_KEY is set',
            fn () => ! empty(config('app.key')),
            'Set APP_KEY to a unique generated value (php artisan key:generate)',
        );

        $failures += $this->checkProduction(
            'APP_DEBUG is false',
            fn () => config('app.debug') === false,
            'Set APP_DEBUG=false in production — stack traces must never be visible to users',
            $isProduction,
        );

        $failures += $this->checkProduction(
            'APP_URL uses HTTPS',
            fn () => str_starts_with((string) config('app.url'), 'https://'),
            'Set APP_URL=https://app.yourdomain.com for correct URL generation and OAuth',
            $isProduction,
        );

        $failures += $this->checkProduction(
            'QUEUE_CONNECTION is redis',
            fn () => config('queue.default') === 'redis',
            'Set QUEUE_CONNECTION=redis — all external API calls and emails must be queued',
            $isProduction,
        );

        $failures += $this->checkProduction(
            'SESSION_DRIVER is redis',
            fn () => config('session.driver') === 'redis',
            'Set SESSION_DRIVER=redis — file sessions do not work across multiple containers',
            $isProduction,
        );

        $failures += $this->checkProduction(
            'SESSION_SECURE_COOKIE is true',
            fn () => config('session.secure') === true,
            'Set SESSION_SECURE_COOKIE=true — cookies must only be sent over HTTPS in production',
            $isProduction,
        );

        $failures += $this->checkProduction(
            'REDIS_PASSWORD is set',
            fn () => ! empty(config('database.redis.default.password')),
            'Set REDIS_PASSWORD to a strong password — unauthenticated Redis must not run in production',
            $isProduction,
        );

        if ($failures === 0) {
            $this->info('All checks passed.');

            return self::SUCCESS;
        }

        $this->error("{$failures} check(s) failed. Fix the issues above before deploying.");

        return self::FAILURE;
    }

    /** @param callable(): bool $check */
    private function check(string $label, callable $check, string $remedy): int
    {
        if ($check()) {
            $this->line("  <fg=green>PASS</> {$label}");

            return 0;
        }

        $this->line("  <fg=red>FAIL</> {$label}");
        $this->line("       {$remedy}");

        return 1;
    }

    /** @param callable(): bool $check */
    private function checkProduction(string $label, callable $check, string $remedy, bool $isProduction): int
    {
        if (! $isProduction) {
            $this->line("  <fg=yellow>WARN</> {$label} (skipped — not in production)");

            return 0;
        }

        return $this->check($label, $check, $remedy);
    }
}
