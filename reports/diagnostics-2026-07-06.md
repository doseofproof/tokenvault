# TokenVault Diagnostics — 2026-07-06

Agent: fable-cowork. Environment note: commands ran in a sandboxed Linux workspace whose `os.homedir()` is NOT the real `~`. CLI stats/cache therefore read empty sandbox-local state files — their zeros are an environment artifact, not fleet state. The real state file (`~/.hermes/tokenvault/cache-monitor.json` on the host) was read separately via the mounted path.

## 1. `node --test tests/`

FAILED before any fix — but for an invocation reason, not a code reason:

```
Error: Cannot find module '.../tokenvault/tests'
# tests 1 / pass 0 / fail 1  (MODULE_NOT_FOUND)
```

On this Node (v22.22.3) the bare directory arg does not resolve; `node --test tests/*.js` works. ASSUMPTION MADE: package.json `scripts.test` ("node --test tests/") worked on the machine where "71/71" was recorded; the glob form is the portable invocation and is what all results below use.

## 2. `node bin/tokenvault stats` / `cache`

Ran clean, rendered dashboard. All zeros — sandbox artifact (see header). No errors; CLI itself healthy.

## 3. Real cache state (host `~/.hermes/tokenvault/cache-monitor.json`)

```
totalRequests: 21, cacheHits: 8, cacheMisses: 13, hitRate: "38.1"
byProvider.anthropic: requests 21, hits 8, misses 13, writes 1, savings 30.5721
```

Two findings:
1. **Actual Anthropic hit rate on record is 38.1% — NOT the claimed 88%.** 38.1% is `warning` tier per getCacheHealth (<70%). The 88% figure appears only in commit messages (9629179, eace04b) with no artifact, and 9629179 attributes it to OpenAI anyway.
2. **totalSavings $30.5721 on 21 requests is the 1000x unit bug live in production data** (parseCacheUsage, fixed this session): plausible true savings ≈ $0.03.

## 4. Baseline test suite (glob invocation, pre-fix)

71 tests passing — including `test-prompt-cache.js:17`, which asserted the INVALID top-level cache_control shape (a green test defending a bug).
