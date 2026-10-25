<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('websites', function (Blueprint $table) {
            $table->string('ga4_property_id')->nullable()->after('primary_conversion');
            $table->string('gsc_site_url')->nullable()->after('ga4_property_id');
        });
    }

    public function down(): void
    {
        Schema::table('websites', function (Blueprint $table) {
            $table->dropColumn(['ga4_property_id', 'gsc_site_url']);
        });
    }
};
