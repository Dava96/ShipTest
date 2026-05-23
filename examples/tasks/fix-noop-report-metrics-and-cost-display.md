# Fix no-op report metrics and cost display

The HTML report should not reward failed or no-op attempts with strong model capability scores. It should also keep metric card text contained and display estimated cost compactly while preserving precise values for inspection.

## Requirements

- Model capability metrics must not give failed/no-op attempts credit for:
  - tool reliability
  - patch focus
  - quality
  - speed
- If a model has no successful completed attempt with observed tool calls, tool reliability should not render as `100/100`.
- If a model has no successful completed attempt with changed files, patch focus should not render as `100/100`.
- Benchmark and model report signal counts should include attempt-level quality signals.
- Non-completed attempts should not display successful evaluation verdict/score semantics in model or quality tables.
- The total estimated cost card should display compact currency, e.g. `$0.00`, and expose the more precise value in hover/title text, e.g. `$0.0000`.
- Metric values should stay contained within their cards using CSS overflow protection.

## Tests

Add or update report tests proving:

- failed/no-op attempts render tool reliability as `0/100`
- failed/no-op attempts render patch focus as `0/100`
- quality signals are visible in benchmark detail pages
- the cost card displays the compact value while retaining a precise hover/title value
