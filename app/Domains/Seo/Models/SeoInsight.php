<?php

declare(strict_types=1);

namespace App\Domains\Seo\Models;

use App\Domains\Clients\Models\Website;
use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Enums\SeoInsightType;
use Database\Factories\SeoInsightFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SeoInsight extends Model
{
    use HasFactory;

    protected static function newFactory(): SeoInsightFactory
    {
        return SeoInsightFactory::new();
    }

    protected $fillable = [
        'organization_id',
        'website_id',
        'generated_by',
        'reviewed_by',
        'type',
        'status',
        'severity',
        'subject_type',
        'subject_value',
        'signature_hash',
        'title',
        'summary',
        'recommendation',
        'date_from',
        'date_to',
        'evidence',
        'reviewed_at',
        'review_notes',
    ];

    protected function casts(): array
    {
        return [
            'type' => SeoInsightType::class,
            'status' => SeoInsightStatus::class,
            'date_from' => 'date',
            'date_to' => 'date',
            'evidence' => 'array',
            'reviewed_at' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function website(): BelongsTo
    {
        return $this->belongsTo(Website::class);
    }

    public function generatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'generated_by');
    }

    public function reviewedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }
}
