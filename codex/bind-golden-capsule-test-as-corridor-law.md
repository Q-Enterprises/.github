# Bind Golden Capsule Test as Corridor Law

This note captures how to bind the “golden capsule” verification into CI as an invariant gate.

## Intent
- Treat the golden capsule replay bundle as a non-negotiable invariant check.
- Fail the workflow if the bundle hash chain, manifest, or checkpoints are invalid.

## CI binding
1. Provide a replay bundle path via `GOLDEN_CAPSULE_BUNDLE`.
2. Run `scripts/golden-capsule-test.mjs` with that path.
3. Ensure the step is required on protected branches.

## Local usage
```bash
GOLDEN_CAPSULE_BUNDLE=./replays/ARC-YYYYMMDD-HHMMSS-<id> \
  node scripts/golden-capsule-test.mjs
```

## Expected behavior
- Missing or invalid bundle → exit 1 (fail-closed).
- Valid bundle → exit 0.
