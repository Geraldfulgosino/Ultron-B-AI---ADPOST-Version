# SEO Execution Security

Applies to every component that fetches a third-party website for an audit (Edge Functions now, durable worker later).
Implemented: `apps/adpost-web/src/domain/urlSafety.ts` (38 tests). Design adapted from claude-seo `scripts/url_safety.py` (MIT, `6be93f4`).

## Rules
1. **Only audit authorized websites.** The target must be a `websites` row of a brand the caller can write to (checked server-side with the caller's JWT, never trusted from the request body). Ad-hoc URLs are allowed only on a host that belongs to one of the brand's websites.
2. **URL validation** (`validatePublicUrl`): http/https only; no embedded credentials; ports 80/443 only; reject localhost and internal suffixes (`.local`, `.internal`, cloud metadata names); reject private, loopback, link-local, CGNAT, reserved, multicast and documentation IPv4/IPv6, including IPv4-mapped/NAT64 forms and obfuscated IPv4 (decimal, hex, octal, short).
3. **DNS:** resolve before every request; reject if **any** answer is non-public (`assertResolvedPublic`).
4. **Redirects:** never auto-follow. Every hop is re-validated and re-resolved, at most 5 hops, and the chain is kept as evidence.
5. **Limits:** 15 s per request, 2 MB body cap (truncation is reported), plus per-skill page and time limits from the registry. Concurrency is at most 2 requests per host, at least 1 s apart. Identifying User-Agent; robots.txt is respected for crawls (worker).
6. **Untrusted content:** fetched HTML/text is data. It goes into the model in a delimited block marked untrusted. Instructions inside it are ignored by the system prompt, and the model may not call tools because page text says so. Only allow-listed tools run, re-authorized per call.
7. **Evidence:** a finding needs captured evidence (URL, status, header or excerpt, timestamp). With no evidence, the result is "not verified", never a claimed issue.

## Residual risk
- **DNS rebinding in Edge Functions:** Deno `fetch` cannot pin the connection to the validated IP, so a hostile DNS server could answer differently between the check and the connect. Mitigations: resolve immediately before each request, keep hops short, reject private answers, and Supabase's egress environment. The **durable worker must pin IPs** (as upstream does) before running crawls.
- Headless rendering (Playwright) runs only in the worker, sandboxed, with the same network policy enforced at the egress firewall.
