# Budgeting: split token budgets and report token/cost breakdowns

Improve ShipTest token budgeting and reporting so cached tokens are not treated the same as fresh input/output tokens.

## Problem

Pi exposes separate usage fields:

```txt
input
output
cacheRead
cacheWrite
totalTokens
cost.input
cost.output
cost.cacheRead
cost.cacheWrite
cost.total
```

`input` is fresh/non-cached model input across requests. `cacheRead` and `cacheWrite` are separate cache-related token categories. `totalTokens` is the sum of the token components.

ShipTest currently treats total tokens as the primary budget/reporting value, which can be misleading for long-context cached runs. A run can show millions of total tokens while most of them are cache reads with different pricing.

## Requirements

### Semantic usage interface

Introduce a ShipTest-owned semantic usage shape so future non-Pi harnesses can report equivalent data without coupling the rest of ShipTest to Pi's raw field names.

Suggested fields:

```ts
input_tokens
output_tokens
cache_read_tokens
cache_write_tokens
total_tokens
uncached_tokens
estimated_cost_usd
source
```

Map Pi usage into this shape:

- `usage.input` -> `input_tokens`
- `usage.output` -> `output_tokens`
- `usage.cacheRead` -> `cache_read_tokens`
- `usage.cacheWrite` -> `cache_write_tokens`
- `usage.totalTokens` -> `total_tokens`
- `usage.cost.*` -> `estimated_cost_usd.*`

`uncached_tokens` should be derived as:

```txt
input_tokens + output_tokens + cache_write_tokens
```

### Split budgets

Keep existing `max_total_tokens`, but add independent optional limits:

```yaml
limits:
  max_uncached_tokens: 1000000
  max_output_tokens: 250000
  max_cache_read_tokens: 5000000
  max_estimated_cost_usd: 2
```

Each budget should emit a specific signal when exceeded, for example:

```txt
max_uncached_tokens_exceeded
max_output_tokens_exceeded
max_cache_read_tokens_exceeded
max_estimated_cost_usd_exceeded
```

Avoid using `billable_tokens` terminology because cache reads can still be billable depending on provider/model pricing.

### Reporting

Update `results.json` and the HTML report to surface token/cost breakdowns:

- input/fresh tokens
- output tokens
- cache read tokens
- cache write tokens
- uncached tokens
- total tokens
- estimated cost

The report should make it clear when total tokens are dominated by cache reads.

### Example config

Update `examples/shiptest.yaml` to use split budgets so long cached runs are less likely to fail solely because cache reads dominate total tokens.

## Verification

Run:

```bash
npm run typecheck
npm run test:run -- src/agent/pi-events.test.ts src/agent/pi-json-harness.test.ts src/reporting/html-report.test.ts src/run/run.test.ts
npm run build
```

Manual smoke check:

```bash
npx shiptest run -c examples/shiptest.yaml --benchmark report-total-estimated-cost --model gpt-5.4-mini --draft --yes
```

Confirm the report shows token breakdowns and estimated cost.
