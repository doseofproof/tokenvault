---
status: draft
type: incident
skill: cache-health-check
timestamp: 2026-07-06T22:47:20.780Z
verification: pending per PROTOCOL §4/G10
---

Cache health CRITICAL: score 10 (<50), hit rate 0% — escalating to Dre per CLAUDE.md B1 step 7. Do not tune alert thresholds to silence this.

## Six-check results

- **1_confirm_hit_rate** [critical]: cacheMonitor hitRate 0%, score 10; observability hitRate 0.0% (divergence 0pt)
- **2_mutable_prompts** [warning]: 9 mutable-prompt invalidations on record; pass --system-file to probe live
- **3_tool_schema_churn** [warning]: 10 schema-change invalidations; live check requires detectToolSchemaInstability(prev, curr) at call site
- **4_compression_shifts** [warning]: 14 shifts / 0 requests
- **5_prefix_divergence** [info]: run validatePrefixStability(previousPrefix, currentPrefix) (openaiCache.js:179) at the call site; divergencePoint locates the mutation
- **6_ttl_gaps** [pass]: 0 inter-request gaps exceed the 5m TTL

## Raw report

```json
{
  "skill": "cache-health-check",
  "at_request": 25,
  "health": "degraded",
  "score": 10,
  "hit_rate_pct": 0,
  "invalidations": {
    "compressionShifts": 14,
    "mutablePrompts": 9,
    "toolSchemaChanges": 10
  },
  "divergence_vs_observability_pct": 0,
  "action_taken": "B1 checks executed; recommendations: Move mutable content after stable prefix; Determinize tool schema serialization; Check for context compression cache invalidation; Re-anchor cache_control after compression",
  "escalated_to_dre": true,
  "checks": [
    {
      "name": "1_confirm_hit_rate",
      "status": "critical",
      "detail": "cacheMonitor hitRate 0%, score 10; observability hitRate 0.0% (divergence 0pt)"
    },
    {
      "name": "2_mutable_prompts",
      "status": "warning",
      "counter": 9,
      "live_probe": "unavailable_offline",
      "detail": "9 mutable-prompt invalidations on record; pass --system-file to probe live"
    },
    {
      "name": "3_tool_schema_churn",
      "status": "warning",
      "counter": 10,
      "live_probe": "unavailable_offline",
      "detail": "10 schema-change invalidations; live check requires detectToolSchemaInstability(prev, curr) at call site"
    },
    {
      "name": "4_compression_shifts",
      "status": "warning",
      "counter": 14,
      "detail": "14 shifts / 0 requests"
    },
    {
      "name": "5_prefix_divergence",
      "status": "info",
      "live_probe": "unavailable_offline",
      "detail": "run validatePrefixStability(previousPrefix, currentPrefix) (openaiCache.js:179) at the call site; divergencePoint locates the mutation"
    },
    {
      "name": "6_ttl_gaps",
      "status": "pass",
      "counter": 0,
      "detail": "0 inter-request gaps exceed the 5m TTL"
    }
  ]
}
```

---
status: draft
type: incident
skill: cache-health-check
timestamp: 2026-07-06T22:47:20.815Z
verification: pending per PROTOCOL §4/G10
---

Cache health CRITICAL: score 10 (<50), hit rate 0% — escalating to Dre per CLAUDE.md B1 step 7. Do not tune alert thresholds to silence this.

## Six-check results

- **1_confirm_hit_rate** [critical]: cacheMonitor hitRate 0%, score 10; observability hitRate 0.0% (divergence 0pt)
- **2_mutable_prompts** [fail]: mutable content detected: timestamp, session_id, timestamp_field — apply CLAUDE.md A5
- **3_tool_schema_churn** [warning]: 10 schema-change invalidations; live check requires detectToolSchemaInstability(prev, curr) at call site
- **4_compression_shifts** [warning]: 14 shifts / 0 requests
- **5_prefix_divergence** [info]: run validatePrefixStability(previousPrefix, currentPrefix) (openaiCache.js:179) at the call site; divergencePoint locates the mutation
- **6_ttl_gaps** [pass]: 0 inter-request gaps exceed the 5m TTL

## Raw report

```json
{
  "skill": "cache-health-check",
  "at_request": 25,
  "health": "degraded",
  "score": 10,
  "hit_rate_pct": 0,
  "invalidations": {
    "compressionShifts": 14,
    "mutablePrompts": 9,
    "toolSchemaChanges": 10
  },
  "divergence_vs_observability_pct": 0,
  "action_taken": "B1 checks executed; recommendations: Move mutable content after stable prefix; Determinize tool schema serialization; Check for context compression cache invalidation; Re-anchor cache_control after compression",
  "escalated_to_dre": true,
  "checks": [
    {
      "name": "1_confirm_hit_rate",
      "status": "critical",
      "detail": "cacheMonitor hitRate 0%, score 10; observability hitRate 0.0% (divergence 0pt)"
    },
    {
      "name": "2_mutable_prompts",
      "status": "fail",
      "counter": 9,
      "live_probe": [
        "timestamp",
        "session_id",
        "timestamp_field"
      ],
      "detail": "mutable content detected: timestamp, session_id, timestamp_field — apply CLAUDE.md A5"
    },
    {
      "name": "3_tool_schema_churn",
      "status": "warning",
      "counter": 10,
      "live_probe": "unavailable_offline",
      "detail": "10 schema-change invalidations; live check requires detectToolSchemaInstability(prev, curr) at call site"
    },
    {
      "name": "4_compression_shifts",
      "status": "warning",
      "counter": 14,
      "detail": "14 shifts / 0 requests"
    },
    {
      "name": "5_prefix_divergence",
      "status": "info",
      "live_probe": "unavailable_offline",
      "detail": "run validatePrefixStability(previousPrefix, currentPrefix) (openaiCache.js:179) at the call site; divergencePoint locates the mutation"
    },
    {
      "name": "6_ttl_gaps",
      "status": "pass",
      "counter": 0,
      "detail": "0 inter-request gaps exceed the 5m TTL"
    }
  ]
}
```

---
status: draft
type: incident
skill: cache-health-check
timestamp: 2026-07-06T22:47:33.256Z
verification: pending per PROTOCOL §4/G10
---

Cache health CRITICAL: score 10 (<50), hit rate 0% — escalating to Dre per CLAUDE.md B1 step 7. Do not tune alert thresholds to silence this.

## Six-check results

- **1_confirm_hit_rate** [critical]: cacheMonitor hitRate 0%, score 10; observability hitRate 0.0% (divergence 0pt)
- **2_mutable_prompts** [warning]: 10 mutable-prompt invalidations on record; pass --system-file to probe live
- **3_tool_schema_churn** [warning]: 10 schema-change invalidations; live check requires detectToolSchemaInstability(prev, curr) at call site
- **4_compression_shifts** [warning]: 14 shifts / 0 requests
- **5_prefix_divergence** [info]: run validatePrefixStability(previousPrefix, currentPrefix) (openaiCache.js:179) at the call site; divergencePoint locates the mutation
- **6_ttl_gaps** [warning]: 1 inter-request gaps exceed the 5m TTL — hits structurally impossible across those gaps (B1.6): batch closer or justify 1h TTL in ChangeLog

## Raw report

```json
{
  "skill": "cache-health-check",
  "at_request": 25,
  "health": "degraded",
  "score": 10,
  "hit_rate_pct": 0,
  "invalidations": {
    "compressionShifts": 14,
    "mutablePrompts": 10,
    "toolSchemaChanges": 10
  },
  "divergence_vs_observability_pct": 0,
  "action_taken": "B1 checks executed; recommendations: Move mutable content after stable prefix; Determinize tool schema serialization; Check for context compression cache invalidation; Re-anchor cache_control after compression",
  "escalated_to_dre": true,
  "checks": [
    {
      "name": "1_confirm_hit_rate",
      "status": "critical",
      "detail": "cacheMonitor hitRate 0%, score 10; observability hitRate 0.0% (divergence 0pt)"
    },
    {
      "name": "2_mutable_prompts",
      "status": "warning",
      "counter": 10,
      "live_probe": "unavailable_offline",
      "detail": "10 mutable-prompt invalidations on record; pass --system-file to probe live"
    },
    {
      "name": "3_tool_schema_churn",
      "status": "warning",
      "counter": 10,
      "live_probe": "unavailable_offline",
      "detail": "10 schema-change invalidations; live check requires detectToolSchemaInstability(prev, curr) at call site"
    },
    {
      "name": "4_compression_shifts",
      "status": "warning",
      "counter": 14,
      "detail": "14 shifts / 0 requests"
    },
    {
      "name": "5_prefix_divergence",
      "status": "info",
      "live_probe": "unavailable_offline",
      "detail": "run validatePrefixStability(previousPrefix, currentPrefix) (openaiCache.js:179) at the call site; divergencePoint locates the mutation"
    },
    {
      "name": "6_ttl_gaps",
      "status": "warning",
      "counter": 1,
      "detail": "1 inter-request gaps exceed the 5m TTL — hits structurally impossible across those gaps (B1.6): batch closer or justify 1h TTL in ChangeLog"
    }
  ]
}
```

---
status: draft
type: incident
skill: cache-health-check
timestamp: 2026-07-06T22:47:33.330Z
verification: pending per PROTOCOL §4/G10
---

Cache health CRITICAL: score 10 (<50), hit rate 0% — escalating to Dre per CLAUDE.md B1 step 7. Do not tune alert thresholds to silence this.

## Six-check results

- **1_confirm_hit_rate** [critical]: cacheMonitor hitRate 0%, score 10; observability hitRate 0.0% (divergence 0pt)
- **2_mutable_prompts** [warning]: 11 mutable-prompt invalidations on record; pass --system-file to probe live
- **3_tool_schema_churn** [warning]: 11 schema-change invalidations; live check requires detectToolSchemaInstability(prev, curr) at call site
- **4_compression_shifts** [warning]: 17 shifts / 0 requests
- **5_prefix_divergence** [info]: run validatePrefixStability(previousPrefix, currentPrefix) (openaiCache.js:179) at the call site; divergencePoint locates the mutation
- **6_ttl_gaps** [warning]: 1 inter-request gaps exceed the 5m TTL — hits structurally impossible across those gaps (B1.6): batch closer or justify 1h TTL in ChangeLog

## Raw report

```json
{
  "skill": "cache-health-check",
  "at_request": 25,
  "health": "degraded",
  "score": 10,
  "hit_rate_pct": 0,
  "invalidations": {
    "compressionShifts": 17,
    "mutablePrompts": 11,
    "toolSchemaChanges": 11
  },
  "divergence_vs_observability_pct": 0,
  "action_taken": "B1 checks executed; recommendations: Move mutable content after stable prefix; Determinize tool schema serialization; Check for context compression cache invalidation; Re-anchor cache_control after compression",
  "escalated_to_dre": true,
  "checks": [
    {
      "name": "1_confirm_hit_rate",
      "status": "critical",
      "detail": "cacheMonitor hitRate 0%, score 10; observability hitRate 0.0% (divergence 0pt)"
    },
    {
      "name": "2_mutable_prompts",
      "status": "warning",
      "counter": 11,
      "live_probe": "unavailable_offline",
      "detail": "11 mutable-prompt invalidations on record; pass --system-file to probe live"
    },
    {
      "name": "3_tool_schema_churn",
      "status": "warning",
      "counter": 11,
      "live_probe": "unavailable_offline",
      "detail": "11 schema-change invalidations; live check requires detectToolSchemaInstability(prev, curr) at call site"
    },
    {
      "name": "4_compression_shifts",
      "status": "warning",
      "counter": 17,
      "detail": "17 shifts / 0 requests"
    },
    {
      "name": "5_prefix_divergence",
      "status": "info",
      "live_probe": "unavailable_offline",
      "detail": "run validatePrefixStability(previousPrefix, currentPrefix) (openaiCache.js:179) at the call site; divergencePoint locates the mutation"
    },
    {
      "name": "6_ttl_gaps",
      "status": "warning",
      "counter": 1,
      "detail": "1 inter-request gaps exceed the 5m TTL — hits structurally impossible across those gaps (B1.6): batch closer or justify 1h TTL in ChangeLog"
    }
  ]
}
```

---
status: draft
type: incident
skill: cache-health-check
timestamp: 2026-07-06T22:47:33.366Z
verification: pending per PROTOCOL §4/G10
---

Cache health CRITICAL: score 10 (<50), hit rate 0% — escalating to Dre per CLAUDE.md B1 step 7. Do not tune alert thresholds to silence this.

## Six-check results

- **1_confirm_hit_rate** [critical]: cacheMonitor hitRate 0%, score 10; observability hitRate 0.0% (divergence 0pt)
- **2_mutable_prompts** [fail]: mutable content detected: timestamp, session_id, timestamp_field — apply CLAUDE.md A5
- **3_tool_schema_churn** [warning]: 11 schema-change invalidations; live check requires detectToolSchemaInstability(prev, curr) at call site
- **4_compression_shifts** [warning]: 17 shifts / 0 requests
- **5_prefix_divergence** [info]: run validatePrefixStability(previousPrefix, currentPrefix) (openaiCache.js:179) at the call site; divergencePoint locates the mutation
- **6_ttl_gaps** [warning]: 1 inter-request gaps exceed the 5m TTL — hits structurally impossible across those gaps (B1.6): batch closer or justify 1h TTL in ChangeLog

## Raw report

```json
{
  "skill": "cache-health-check",
  "at_request": 25,
  "health": "degraded",
  "score": 10,
  "hit_rate_pct": 0,
  "invalidations": {
    "compressionShifts": 17,
    "mutablePrompts": 11,
    "toolSchemaChanges": 11
  },
  "divergence_vs_observability_pct": 0,
  "action_taken": "B1 checks executed; recommendations: Move mutable content after stable prefix; Determinize tool schema serialization; Check for context compression cache invalidation; Re-anchor cache_control after compression",
  "escalated_to_dre": true,
  "checks": [
    {
      "name": "1_confirm_hit_rate",
      "status": "critical",
      "detail": "cacheMonitor hitRate 0%, score 10; observability hitRate 0.0% (divergence 0pt)"
    },
    {
      "name": "2_mutable_prompts",
      "status": "fail",
      "counter": 11,
      "live_probe": [
        "timestamp",
        "session_id",
        "timestamp_field"
      ],
      "detail": "mutable content detected: timestamp, session_id, timestamp_field — apply CLAUDE.md A5"
    },
    {
      "name": "3_tool_schema_churn",
      "status": "warning",
      "counter": 11,
      "live_probe": "unavailable_offline",
      "detail": "11 schema-change invalidations; live check requires detectToolSchemaInstability(prev, curr) at call site"
    },
    {
      "name": "4_compression_shifts",
      "status": "warning",
      "counter": 17,
      "detail": "17 shifts / 0 requests"
    },
    {
      "name": "5_prefix_divergence",
      "status": "info",
      "live_probe": "unavailable_offline",
      "detail": "run validatePrefixStability(previousPrefix, currentPrefix) (openaiCache.js:179) at the call site; divergencePoint locates the mutation"
    },
    {
      "name": "6_ttl_gaps",
      "status": "warning",
      "counter": 1,
      "detail": "1 inter-request gaps exceed the 5m TTL — hits structurally impossible across those gaps (B1.6): batch closer or justify 1h TTL in ChangeLog"
    }
  ]
}
```

