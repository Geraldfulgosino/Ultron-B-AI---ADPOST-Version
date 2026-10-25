<?php

declare(strict_types=1);

namespace Tests\Feature\Console;

use Tests\TestCase;

class ValidateEnvironmentTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config([
            'app.env' => 'local',
            'app.debug' => true,
            'app.key' => '',
            'app.url' => 'http://localhost',
            'queue.default' => 'sync',
            'session.driver' => 'file',
        ]);
    }

    public function test_command_passes_with_production_ready_env(): void
    {
        config([
            'app.env' => 'production',
            'app.debug' => false,
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url' => 'https://app.example.com',
            'queue.default' => 'redis',
            'session.driver' => 'redis',
            'session.secure' => true,
            'database.redis.default.password' => 'strongpassword',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(0);
    }

    public function test_command_fails_when_debug_is_true_in_production(): void
    {
        config([
            'app.env' => 'production',
            'app.debug' => true,
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url' => 'https://app.example.com',
            'queue.default' => 'redis',
            'session.driver' => 'redis',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(1);
    }

    public function test_command_fails_when_app_key_is_missing(): void
    {
        config([
            'app.env' => 'production',
            'app.debug' => false,
            'app.key' => '',
            'app.url' => 'https://app.example.com',
            'queue.default' => 'redis',
            'session.driver' => 'redis',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(1);
    }

    public function test_command_fails_when_app_url_is_not_https(): void
    {
        config([
            'app.env' => 'production',
            'app.debug' => false,
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url' => 'http://app.example.com',
            'queue.default' => 'redis',
            'session.driver' => 'redis',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(1);
    }

    public function test_command_exits_zero_when_not_in_production(): void
    {
        config([
            'app.env' => 'local',
            'app.debug' => true,
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url' => 'http://localhost',
            'queue.default' => 'sync',
            'session.driver' => 'file',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(0);
    }

    public function test_command_fails_when_queue_connection_is_sync_in_production(): void
    {
        config([
            'app.env' => 'production',
            'app.debug' => false,
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url' => 'https://app.example.com',
            'queue.default' => 'sync',
            'session.driver' => 'redis',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(1);
    }

    public function test_command_fails_when_session_driver_is_not_redis_in_production(): void
    {
        config([
            'app.env' => 'production',
            'app.debug' => false,
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url' => 'https://app.example.com',
            'queue.default' => 'redis',
            'session.driver' => 'file',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(1);
    }

    public function test_command_fails_when_session_secure_cookie_is_false_in_production(): void
    {
        config([
            'app.env' => 'production',
            'app.debug' => false,
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url' => 'https://app.example.com',
            'queue.default' => 'redis',
            'session.driver' => 'redis',
            'session.secure' => false,
            'database.redis.default.password' => 'strongpassword',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(1);
    }

    public function test_command_fails_when_redis_password_is_null_in_production(): void
    {
        config([
            'app.env' => 'production',
            'app.debug' => false,
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url' => 'https://app.example.com',
            'queue.default' => 'redis',
            'session.driver' => 'redis',
            'session.secure' => true,
            'database.redis.default.password' => null,
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(1);
    }

    public function test_command_fails_when_redis_password_is_empty_in_production(): void
    {
        config([
            'app.env' => 'production',
            'app.debug' => false,
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.url' => 'https://app.example.com',
            'queue.default' => 'redis',
            'session.driver' => 'redis',
            'session.secure' => true,
            'database.redis.default.password' => '',
        ]);

        $this->artisan('ultron:env:validate')
            ->assertExitCode(1);
    }
}
