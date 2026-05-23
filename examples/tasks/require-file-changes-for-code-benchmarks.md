# Require file changes for code benchmarks

Implementation and replay-change benchmarks are code-change benchmarks by definition. A model that produces no repository changes did not complete the task, even if a broad scoring command happens to pass on the unchanged baseline.

## Requirements

- For `implementation` and `replay_change` benchmarks, require a non-empty repository submission.
- Fail attempts where:
  - no submission exists
  - `submission.changed_files` is empty
  - `submission.is_empty` is true
  - the candidate patch is empty or equivalent to no changes
- Do not add a config escape hatch for these benchmark types. Text-only model response evaluation should be a separate future benchmark type.
- Record clear attempt-level quality signals for no-op submissions.

## Expected signals

Add attempt-level quality signals such as:

- `required_file_changes_missing`
- `empty_submission_patch`

## Tests

Add or update tests proving:

- an implementation benchmark with no changed files becomes `agent_failed`
- an implementation benchmark with an empty patch becomes `agent_failed`
- these attempts do not count as passed, even if the evaluation command would otherwise pass
