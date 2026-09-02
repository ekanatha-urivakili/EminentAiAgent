# Testing Standards

## Strategy

- Derive tests from risks, acceptance criteria, contracts, state transitions, and failure modes.
- Keep most tests deterministic and close to the code; use fewer integration and end-to-end tests for critical journeys.
- Test behavior, not implementation details. Avoid flaky sleeps, shared mutable fixtures, and order dependence.
- Run production-like tests with sanitized data and representative topology.
- Define pass/fail thresholds before execution.

## Test case format

```markdown
### TC-<area>-NNN: Title
- Requirement/risk:
- Preconditions and data:
- Steps:
  1.
- Expected result:
- Evidence:
- Priority:
- Automation level:
```

## UI

- Critical journeys, routing, forms, validation, loading/empty/error states, cancellation, retry, concurrency, and session expiry.
- Keyboard operation, focus order, visible focus, semantic structure, labels, contrast, zoom/reflow, reduced motion, and screen-reader behavior against the required WCAG level.
- Responsive layouts and supported browser/device matrix.
- XSS rendering, open redirects, clickjacking controls, CSRF, cache isolation, and logout cleanup.
- Visual regression for stable, high-value surfaces; avoid brittle full-page snapshots.

## API and contract

- OpenAPI/AsyncAPI schema validation in CI and consumer/provider compatibility.
- Authentication, authorization per role/tenant/object, required headers, content negotiation, validation boundaries, error schema, pagination, filtering, sorting, idempotency, concurrency, rate limits, and cache semantics.
- Duplicate, out-of-order, malformed, oversized, replayed, and timed-out requests.
- Backward compatibility and deprecation behavior.

## Integration and end-to-end

- Real database/message broker integration for queries, constraints, transactions, migrations, serialization, and delivery semantics.
- Contract-controlled third-party sandboxes or service virtualization for deterministic failures.
- Critical path plus payment/webhook, retry, reconciliation, partial failure, and rollback scenarios.
- Verify observable business outcomes, not only HTTP responses.

## Performance and resilience

- Establish workload model: arrival rate, concurrency, payload distribution, hot keys, read/write ratio, data volume, cache state, and background work.
- Run baseline, load, stress, spike, soak, scalability, and capacity tests.
- Measure client and server percentiles, throughput, errors, saturation, queue lag, database waits, resource use, and cost per transaction.
- Test cold starts, cache miss, dependency latency/failure, zone loss, worker crash, poison messages, restoration, and recovery objectives.
- Do not average away tail latency. Report p50, p95, p99, max, and error rate.

## Security

- Cover OWASP web/API risks, access control, injection, SSRF, unsafe file handling, deserialization, token validation, CORS/CSP, secret leakage, dependency risk, and abuse-rate controls.
- Use authorized scope and safe environments for DAST, fuzzing, and penetration tests.
- Retest fixes and preserve evidence linked to findings.

## CI gates

1. Format, lint, type-check, unit tests.
2. Contract and component tests.
3. Integration tests with real infrastructure.
4. SAST, SCA, secrets, IaC, and container scans.
5. Build immutable artifact and SBOM.
6. Deploy to representative environment; run smoke and critical E2E.
7. Run performance/resilience tests on risk-triggered changes.
