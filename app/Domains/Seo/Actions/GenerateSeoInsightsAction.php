<?php

declare(strict_types=1);

namespace App\Domains\Seo\Actions;

use App\Domains\Identity\Models\User;
use App\Domains\Organizations\Models\Organization;
use App\Domains\Seo\Agents\AnalyticsSummaryAgent;
use App\Domains\Seo\Enums\SeoInsightStatus;
use App\Domains\Seo\Models\SeoInsight;

class GenerateSeoInsightsAction
{
    public function __construct(private readonly AnalyticsSummaryAgent $agent) {}

    public function execute(Organization $organization, User $user): int
    {
        $createdOrUpdated = 0;

        foreach ($this->agent->analyze($organization) as $payload) {
            $signatureHash = $this->signatureHash($organization->id, $payload);

            SeoInsight::updateOrCreate([
                'organization_id' => $organization->id,
                'signature_hash' => $signatureHash,
            ], [
                'website_id' => $payload['website_id'],
                'generated_by' => $user->id,
                'type' => $payload['type'],
                'status' => SeoInsightStatus::Pending,
                'severity' => $payload['severity'],
                'subject_type' => $payload['subject_type'],
                'subject_value' => $payload['subject_value'],
                'title' => $payload['title'],
                'summary' => $payload['summary'],
                'recommendation' => $payload['recommendation'],
                'date_from' => $payload['date_from'],
                'date_to' => $payload['date_to'],
                'evidence' => $payload['evidence'],
            ]);

            $createdOrUpdated++;
        }

        return $createdOrUpdated;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function signatureHash(int $organizationId, array $payload): string
    {
        return hash('sha256', implode('|', [
            $organizationId,
            $payload['website_id'] ?? 'organization',
            $payload['type']->value,
            $payload['subject_type'],
            $payload['subject_value'],
            $payload['date_from'],
            $payload['date_to'],
        ]));
    }
}
