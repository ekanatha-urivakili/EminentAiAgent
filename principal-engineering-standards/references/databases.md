# SQL, PostgreSQL, and MySQL Standards

- Model business invariants with primary keys, foreign keys, unique constraints, checks, and appropriate nullability.
- Normalize transactional data first; denormalize only for measured access patterns with a consistency owner.
- Use parameterized queries exclusively. Apply least-privilege roles and separate migration/runtime credentials.
- Select only required columns; bound queries and pagination. Avoid unbounded offsets at scale; prefer stable keyset pagination.
- Index from observed query plans and workload. Account for write amplification, storage, and maintenance.
- Keep transactions short and define isolation from anomaly requirements. Make deadlock retries safe and bounded.
- Avoid application-level read-modify-write races; use atomic statements, constraints, or explicit locking.
- Review every migration for locking, table rewrites, compatibility, rollback/forward-fix, and replication impact.
- Encrypt connections, protect backups, classify columns, audit privileged access, and test point-in-time recovery.
- Monitor latency percentiles, throughput, errors, connections, locks, deadlocks, cache hit ratio, replication lag, storage growth, and slow queries.

## PostgreSQL

- Use `jsonb` for genuinely variable documents, not to bypass relational modeling.
- Use `EXPLAIN (ANALYZE, BUFFERS)` safely on representative workloads.
- Maintain autovacuum health, transaction ID age, statistics, and connection pooling.
- Use row-level security only with tested policies and an explicit bypass-role model.

## MySQL

- Use InnoDB, `utf8mb4`, explicit time zones, and strict SQL modes.
- Understand leftmost-prefix indexing and inspect `EXPLAIN ANALYZE` on supported versions.
- Monitor gap locks, deadlocks, replication lag, and long transactions.
- Verify online DDL behavior for the exact engine/version and table shape before production.

## ERD checklist

For each entity record owner, PK strategy, natural/unique keys, tenant boundary, PII classification, retention, timestamps, concurrency token, indexes, cascade behavior, and deletion/anonymization path.
