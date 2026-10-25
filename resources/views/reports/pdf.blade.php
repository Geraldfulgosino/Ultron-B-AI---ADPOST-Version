<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>{{ $reportType }} — {{ $organizationName }}</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
        font-family: DejaVu Sans, sans-serif;
        font-size: 10.5px;
        color: #1e293b;
        background: #ffffff;
        line-height: 1.5;
    }

    /* ── Header ── */
    .header {
        background-color: #4f46e5;
        color: #ffffff;
        padding: 24px 32px 20px;
    }
    .header-brand {
        font-size: 15px;
        font-weight: bold;
        letter-spacing: 1.5px;
        text-transform: uppercase;
    }
    .header-title {
        font-size: 20px;
        font-weight: bold;
        margin-top: 6px;
    }
    .header-org {
        font-size: 11px;
        margin-top: 4px;
        opacity: 0.85;
    }
    .header-meta {
        font-size: 9px;
        margin-top: 10px;
        opacity: 0.75;
        border-top: 1px solid rgba(255,255,255,0.25);
        padding-top: 8px;
    }

    /* ── Content wrapper ── */
    .content { padding: 20px 32px 32px; }

    /* ── Section headings ── */
    h2 {
        font-size: 12px;
        font-weight: bold;
        color: #4f46e5;
        border-bottom: 1.5px solid #e2e8f0;
        padding-bottom: 5px;
        margin-top: 22px;
        margin-bottom: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    /* ── Executive summary ── */
    .summary-box {
        background-color: #f8fafc;
        border-left: 3px solid #4f46e5;
        padding: 10px 14px;
        font-size: 10px;
        color: #475569;
        line-height: 1.7;
    }

    /* ── KPI metric cards (table-based for dompdf) ── */
    .kpi-table { width: 100%; border-collapse: separate; border-spacing: 6px; }
    .kpi-cell {
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        padding: 12px 10px;
        text-align: center;
        width: 25%;
    }
    .kpi-label {
        font-size: 8.5px;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        font-weight: bold;
    }
    .kpi-value {
        font-size: 22px;
        font-weight: bold;
        color: #1e293b;
        margin-top: 5px;
        display: block;
    }
    .kpi-sub {
        font-size: 8.5px;
        color: #94a3b8;
        margin-top: 2px;
    }

    /* ── Data tables ── */
    table.data-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 10px;
        margin-top: 6px;
    }
    table.data-table th {
        background-color: #f1f5f9;
        padding: 6px 8px;
        text-align: left;
        font-weight: bold;
        color: #475569;
        border-bottom: 1.5px solid #cbd5e1;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
    }
    table.data-table th.right { text-align: right; }
    table.data-table td {
        padding: 5px 8px;
        border-bottom: 1px solid #f1f5f9;
        color: #334155;
    }
    table.data-table td.right { text-align: right; font-variant-numeric: tabular-nums; }
    table.data-table tr:last-child td { border-bottom: none; }
    table.data-table tr:nth-child(even) td { background-color: #fafafa; }

    /* ── Insight severity labels ── */
    .sev { font-size: 8.5px; font-weight: bold; padding: 1px 5px; }
    .sev-high   { color: #dc2626; background-color: #fef2f2; }
    .sev-medium { color: #ea580c; background-color: #fff7ed; }
    .sev-low    { color: #2563eb; background-color: #eff6ff; }
    .sev-info   { color: #0891b2; background-color: #ecfeff; }

    /* ── Recommendations ── */
    .rec-item {
        padding: 5px 0 5px 14px;
        border-bottom: 1px solid #f1f5f9;
        font-size: 10px;
        color: #334155;
        position: relative;
    }

    /* ── Empty / no-data states ── */
    .empty {
        padding: 10px 8px;
        color: #94a3b8;
        font-style: italic;
        font-size: 10px;
    }

    /* ── No-data full page ── */
    .no-data-box {
        margin-top: 18px;
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        padding: 20px;
        text-align: center;
        color: #64748b;
        font-size: 11px;
    }

    /* ── Footer ── */
    .footer {
        margin-top: 28px;
        padding-top: 10px;
        border-top: 1px solid #e2e8f0;
        font-size: 8.5px;
        color: #94a3b8;
        text-align: center;
    }
</style>
</head>
<body>

{{-- ── Header ── --}}
<div class="header">
    <div class="header-brand">ULTRON-B AI</div>
    <div class="header-title">{{ $reportType }}</div>
    <div class="header-org">{{ $organizationName }}@if($websiteLabel !== 'All websites') &nbsp;&#183;&nbsp; {{ $websiteLabel }}@endif</div>
    <div class="header-meta">
        Date Range: {{ $filters['date_from'] }} to {{ $filters['date_to'] }}
        &nbsp;&#183;&nbsp;
        Data Source: {{ $sourceLabel }}
        &nbsp;&#183;&nbsp;
        Generated: {{ $generatedAt }}
    </div>
</div>

<div class="content">

{{-- ── Executive Summary ── --}}
<h2>Executive Summary</h2>
<div class="summary-box">{{ $executiveSummary }}</div>

@if(!$hasData)
<div class="no-data-box">
    No report data is available for the selected date range and filters.<br>
    Data will appear here once analytics have been synced for this period.
</div>
@else

{{-- ── Key Metrics ── --}}
<h2>Key Metrics</h2>
<table class="kpi-table">
    <tr>
        @if($showGsc)
        <td class="kpi-cell">
            <div class="kpi-label">GSC Clicks</div>
            <span class="kpi-value">{{ number_format($summary['gsc_clicks']) }}</span>
            <div class="kpi-sub">Organic clicks</div>
        </td>
        <td class="kpi-cell">
            <div class="kpi-label">GSC Impressions</div>
            <span class="kpi-value">{{ number_format($summary['gsc_impressions']) }}</span>
            <div class="kpi-sub">Search appearances</div>
        </td>
        @endif
        @if($showGa4)
        <td class="kpi-cell">
            <div class="kpi-label">GA4 Sessions</div>
            <span class="kpi-value">{{ number_format($summary['ga4_sessions']) }}</span>
            <div class="kpi-sub">Organic sessions</div>
        </td>
        <td class="kpi-cell">
            <div class="kpi-label">GA4 Conversions</div>
            <span class="kpi-value">{{ number_format($summary['ga4_conversions']) }}</span>
            <div class="kpi-sub">Goal completions</div>
        </td>
        @endif
        @if($showGsc && !$showGa4)
        {{-- GSC-only: fill with CTR metric if we have data --}}
        <td class="kpi-cell">
            <div class="kpi-label">Est. CTR</div>
            <span class="kpi-value">
                @if($summary['gsc_impressions'] > 0)
                    {{ round(($summary['gsc_clicks'] / $summary['gsc_impressions']) * 100, 1) }}%
                @else
                    N/A
                @endif
            </span>
            <div class="kpi-sub">Click-through rate</div>
        </td>
        @endif
        @if(!$showGsc && $showGa4)
        {{-- GA4-only: fill remaining cells --}}
        <td class="kpi-cell" style="background:none;border:none;"></td>
        <td class="kpi-cell" style="background:none;border:none;"></td>
        @endif
    </tr>
</table>

{{-- ── GSC Performance ── --}}
@if($showGsc)
<h2>Google Search Console Performance</h2>

@if(!empty($gscTrends))
<table class="data-table">
    <thead>
        <tr>
            <th>Date</th>
            <th class="right">Clicks</th>
            <th class="right">Impressions</th>
        </tr>
    </thead>
    <tbody>
        @foreach($gscTrends as $row)
        <tr>
            <td>{{ $row['date'] }}</td>
            <td class="right">{{ number_format($row['clicks']) }}</td>
            <td class="right">{{ number_format($row['impressions']) }}</td>
        </tr>
        @endforeach
    </tbody>
</table>
@else
<p class="empty">No GSC trend data available for this period.</p>
@endif

@if(!empty($topQueries))
<h2 style="margin-top:14px;">Top Search Queries</h2>
<table class="data-table">
    <thead>
        <tr>
            <th>Query</th>
            <th class="right">Clicks</th>
        </tr>
    </thead>
    <tbody>
        @foreach($topQueries as $row)
        <tr>
            <td>{{ $row['query'] }}</td>
            <td class="right">{{ number_format($row['clicks']) }}</td>
        </tr>
        @endforeach
    </tbody>
</table>
@else
<p class="empty" style="margin-top:8px;">No search queries recorded for this period.</p>
@endif
@endif

{{-- ── GA4 Performance ── --}}
@if($showGa4)
<h2>Google Analytics 4 Performance</h2>

@if(!empty($ga4Trends))
<table class="data-table">
    <thead>
        <tr>
            <th>Date</th>
            <th class="right">Sessions</th>
        </tr>
    </thead>
    <tbody>
        @foreach($ga4Trends as $row)
        <tr>
            <td>{{ $row['date'] }}</td>
            <td class="right">{{ number_format($row['value']) }}</td>
        </tr>
        @endforeach
    </tbody>
</table>
@else
<p class="empty">No GA4 trend data available for this period.</p>
@endif

@if(!empty($topPages))
<h2 style="margin-top:14px;">Top Landing Pages</h2>
<table class="data-table">
    <thead>
        <tr>
            <th>Page Path</th>
            <th class="right">Sessions</th>
        </tr>
    </thead>
    <tbody>
        @foreach($topPages as $row)
        <tr>
            <td>{{ $row['page_path'] }}</td>
            <td class="right">{{ number_format($row['sessions']) }}</td>
        </tr>
        @endforeach
    </tbody>
</table>
@else
<p class="empty" style="margin-top:8px;">No landing page data recorded for this period.</p>
@endif
@endif

{{-- ── SEO Insights ── --}}
<h2>SEO Insights</h2>
@if(!empty($seoInsights))
<table class="data-table">
    <thead>
        <tr>
            <th style="width:40%;">Title</th>
            <th style="width:15%;">Type</th>
            <th style="width:12%;">Severity</th>
            <th style="width:13%;">Status</th>
            <th style="width:20%;">Action</th>
        </tr>
    </thead>
    <tbody>
        @foreach($seoInsights as $insight)
        <tr>
            <td>{{ $insight['title'] ?? '' }}</td>
            <td>{{ $insight['type_label'] ?? '' }}</td>
            <td>
                @php $sev = strtolower($insight['severity'] ?? 'info'); @endphp
                <span class="sev sev-{{ $sev }}">{{ ucfirst($sev) }}</span>
            </td>
            <td>{{ $insight['status_label'] ?? '' }}</td>
            <td style="font-size:9px;color:#64748b;">{{ Str::limit($insight['recommendation'] ?? '', 60) }}</td>
        </tr>
        @endforeach
    </tbody>
</table>
@else
<p class="empty">No SEO insights have been generated for this period.</p>
@endif

{{-- ── Recommendations ── --}}
@if(!empty($recommendations))
<h2>Recommendations</h2>
@foreach($recommendations as $rec)
<div class="rec-item">&#8226; {{ $rec }}</div>
@endforeach
@endif

@endif {{-- end hasData --}}

{{-- ── Footer ── --}}
<div class="footer">
    Generated by ULTRON-B AI &nbsp;&#183;&nbsp; Confidential &mdash; For authorized recipient only &nbsp;&#183;&nbsp; {{ $generatedAt }}
</div>

</div>
</body>
</html>
