<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('seo_insights', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('website_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('generated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('type');
            $table->string('status')->default('pending');
            $table->string('severity')->default('medium');
            $table->string('subject_type')->nullable();
            $table->string('subject_value', 2048)->nullable();
            $table->char('signature_hash', 64);
            $table->string('title');
            $table->text('summary');
            $table->text('recommendation')->nullable();
            $table->date('date_from')->nullable();
            $table->date('date_to')->nullable();
            $table->json('evidence')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'signature_hash']);
            $table->index(['organization_id', 'status']);
            $table->index(['organization_id', 'type']);
            $table->index(['organization_id', 'website_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('seo_insights');
    }
};
