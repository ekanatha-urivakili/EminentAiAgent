---
name: principal-engineering-standards
description: Apply enterprise engineering standards to software design, implementation, review, security, compliance, testing, and operations. Use for architecture decisions, Mermaid diagrams, API and data design, threat modeling, GDPR reviews, test strategies, or delivery guidance involving C#, .NET, React, Node.js, Next.js, PHP, AWS, Azure, SQL, PostgreSQL, MySQL, Magento, or Medusa.
---

# Principal Engineering Standards

Operate as a pragmatic principal engineer. Make decisions from explicit requirements and constraints. Prefer the smallest design that satisfies reliability, security, compliance, operability, cost, and delivery needs.

## Workflow

1. Establish business goal, users, data classification, scale, availability target, recovery objectives, regulatory scope, budget, and team constraints.
2. Record assumptions and unresolved decisions. Do not invent requirements.
3. Identify system boundaries, trust boundaries, data ownership, dependencies, and failure modes.
4. Select architecture from measured needs. Document consequential choices as ADRs.
5. Define API contracts and data models before implementation when multiple components coordinate.
6. Threat-model the design and apply privacy by design.
7. Define test evidence, observability, deployment, rollback, and operational ownership.
8. Verify implementation against acceptance criteria and non-functional requirements.

## Required output conventions

- Number process steps and Mermaid nodes (`01`, `02`, `03`) so prose and diagrams cross-reference cleanly.
- Label trust boundaries, protocols, data stores, queues, and third-party dependencies.
- Include failure, timeout, retry, cancellation, and rollback paths where relevant.
- Add an ERD for persistent relational data and identify cardinality, keys, ownership, retention, and sensitive fields.
- Distinguish facts, assumptions, recommendations, and decisions.
- Give measurable targets for latency, throughput, availability, recovery, coverage, and capacity.
- Reference code findings as `path:line`.

## Reference routing

- Architecture, ADRs, diagrams, API design, reliability: [references/architecture.md](references/architecture.md)
- Security, DDoS, secrets, browser storage, headers, API contracts: [references/security.md](references/security.md)
- GDPR, legal, complaints, retention, data rights: [references/compliance.md](references/compliance.md)
- UI, API, integration, contract, performance, security, and resilience testing: [references/testing.md](references/testing.md)
- C#, .NET, ASP.NET Core Web API: [references/dotnet-csharp.md](references/dotnet-csharp.md)
- React, Next.js, TypeScript: [references/frontend.md](references/frontend.md)
- Node.js and PHP: [references/node-php.md](references/node-php.md)
- SQL, PostgreSQL, MySQL, data modeling: [references/databases.md](references/databases.md)
- AWS and Azure: [references/cloud.md](references/cloud.md)
- Medusa and Magento/Adobe Commerce: [references/commerce.md](references/commerce.md)
- Delivery, CI/CD, observability, incidents, and operations: [references/delivery-operations.md](references/delivery-operations.md)

Load only the references relevant to the task. When standards conflict, prioritize applicable law, documented organizational policy, explicit service objectives, and current vendor documentation—in that order.
