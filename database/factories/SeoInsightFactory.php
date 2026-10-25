<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domains\Organizations\Models\Organization;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Enums\SeoInsightType;
use App\Domains\Seo\Models\SeoInsight;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SeoInsight>
 */
class SeoInsightFactory extends Factory
{
    protected $model = SeoInsight::class;

    public function definition(): array
    {
        $subject = fake()->slug();

        return [
            'organization_id' => Organization::factory(),
            'website_id' => null,
            'type' => SeoInsightType::RankingOpportunity->value,
            'status' => SeoInsightStatus::Pending->value,
            'severity' => 'medium',
            'subject_type' => 'query',
            'subject_value' => $subject,
            'signature_hash' => hash('sha256', fake()->uuid()),
            'title' => 'Ranking opportunity found',
            'summary' => 'A locally generated SEO insight was created.',
            'recommendation' => 'Review the affected query and improve the landing page.',
            'date_from' => now()->subDays(14)->toDateString(),
            'date_to' => now()->toDateString(),
            'evidence' => ['subject' => $subject],
        ];
    }
}
