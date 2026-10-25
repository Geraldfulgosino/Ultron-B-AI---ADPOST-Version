<?php

declare(strict_types=1);

namespace App\Domains\Automation\Models;

use App\Domains\Automation\Enums\N8nDeliveryStatus;
use App\Domains\Organizations\Models\Organization;
use Database\Factories\N8nWebhookDeliveryFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class N8nWebhookDelivery extends Model
{
    use HasFactory;

    protected static function newFactory(): N8nWebhookDeliveryFactory
    {
        return N8nWebhookDeliveryFactory::new();
    }

    protected $fillable = [
        'organization_id',
        'n8n_connection_id',
        'event_name',
        'webhook_url',
        'status',
        'response_code',
        'response_body',
        'error_message',
        'attempts',
        'payload',
        'sent_at',
    ];

    protected function casts(): array
    {
        return [
            'status'  => N8nDeliveryStatus::class,
            'payload' => 'array',
            'sent_at' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function connection(): BelongsTo
    {
        return $this->belongsTo(N8nConnection::class, 'n8n_connection_id');
    }
}
