<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('analytics_daily_metrics', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('website_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('integration_id')->nullable()->constrained()->nullOnDelete();
            $table->date('metric_date');
            $table->unsignedBigInteger('sessions')->default(0);
            $table->unsignedBigInteger('active_users')->default(0);
            $table->unsignedBigInteger('new_users')->default(0);
            $table->unsignedBigInteger('screen_page_views')->default(0);
            $table->unsignedBigInteger('conversions')->default(0);
            $table->decimal('total_revenue', 14, 2)->default(0);
            $table->unsignedBigInteger('clicks')->default(0);
            $table->unsignedBigInteger('impressions')->default(0);
            $table->decimal('ctr', 8, 4)->default(0);
            $table->decimal('average_position', 8, 2)->default(0);
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'website_id', 'integration_id', 'metric_date'], 'analytics_daily_metrics_unique');
            $table->index(['organization_id', 'metric_date']);
            $table->index(['organization_id', 'website_id', 'metric_date'], 'analytics_daily_metrics_org_website_date_index');
        });

        Schema::create('analytics_landing_pages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('website_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('integration_id')->nullable()->constrained()->nullOnDelete();
            $table->date('metric_date');
            $table->string('page_path', 2048);
            $table->char('page_path_hash', 64)->nullable();
            $table->unsignedBigInteger('sessions')->default(0);
            $table->unsignedBigInteger('active_users')->default(0);
            $table->unsignedBigInteger('screen_page_views')->default(0);
            $table->unsignedBigInteger('conversions')->default(0);
            $table->decimal('total_revenue', 14, 2)->default(0);
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'website_id', 'integration_id', 'metric_date', 'page_path_hash'], 'analytics_landing_pages_unique');
            $table->index(['organization_id', 'metric_date']);
        });

        Schema::create('analytics_search_queries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('website_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('integration_id')->nullable()->constrained()->nullOnDelete();
            $table->date('metric_date');
            $table->string('query', 1024);
            $table->char('query_hash', 64)->nullable();
            $table->unsignedBigInteger('clicks')->default(0);
            $table->unsignedBigInteger('impressions')->default(0);
            $table->decimal('ctr', 8, 4)->default(0);
            $table->decimal('average_position', 8, 2)->default(0);
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'website_id', 'integration_id', 'metric_date', 'query_hash'], 'analytics_search_queries_unique');
            $table->index(['organization_id', 'metric_date']);
        });

        Schema::create('analytics_search_pages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('website_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('integration_id')->nullable()->constrained()->nullOnDelete();
            $table->date('metric_date');
            $table->string('page_url', 2048);
            $table->char('page_url_hash', 64)->nullable();
            $table->unsignedBigInteger('clicks')->default(0);
            $table->unsignedBigInteger('impressions')->default(0);
            $table->decimal('ctr', 8, 4)->default(0);
            $table->decimal('average_position', 8, 2)->default(0);
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'website_id', 'integration_id', 'metric_date', 'page_url_hash'], 'analytics_search_pages_unique');
            $table->index(['organization_id', 'metric_date']);
        });

        Schema::create('analytics_sync_histories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('website_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('integration_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('provider');
            $table->string('status')->default('queued');
            $table->date('date_from')->nullable();
            $table->date('date_to')->nullable();
            $table->unsignedInteger('records_synced')->default(0);
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamp('failed_at')->nullable();
            $table->text('error_message')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['organization_id', 'provider', 'status']);
            $table->index(['organization_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('analytics_sync_histories');
        Schema::dropIfExists('analytics_search_pages');
        Schema::dropIfExists('analytics_search_queries');
        Schema::dropIfExists('analytics_landing_pages');
        Schema::dropIfExists('analytics_daily_metrics');
    }
};
