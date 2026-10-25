<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('n8n_webhook_deliveries', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('n8n_connection_id')->constrained('n8n_connections')->cascadeOnDelete();
            $table->string('event_name', 100);
            $table->string('webhook_url', 500);
            $table->string('status', 20)->default('pending');
            $table->smallInteger('response_code')->unsigned()->nullable();
            $table->text('response_body')->nullable();
            $table->string('error_message', 500)->nullable();
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->json('payload');
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();

            $table->index('organization_id');
            $table->index('status');
            $table->index('event_name');
            $table->index('created_at');
            $table->index(['organization_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('n8n_webhook_deliveries');
    }
};
