# Determinism & Ledger Ordering (v1)

This document summarizes deterministic simulation constraints aligned to the Ledger Contract v1.

## Deterministic simulation requirements
- Use fixed-timestep or deterministic integration for sim-time progression.
- Avoid nondeterministic RNG sources; seed any randomness explicitly.
- Eliminate reliance on wall-clock time for simulation state.
- Use stable, repeatable iteration order for entity updates.

## Event ordering rules
- Receipt ordering must be stable and deterministic within a frame.
- Recommended per-frame order:
  1. INPUT_RECORDED
  2. ENGINE_TICK
  3. CONSTRAINT_SOLVE
  4. COLLISION
  5. CHECKPOINT
  6. REPLAY_FINAL

## Canonical serialization rules
- UTF-8 encoding.
- Lexicographic object key order (all levels).
- Arrays preserve order.
- No NaN/Infinity; normalize -0 to 0.
- Use sha256 for all receipt chain and bundle hashes.

## Validation expectations
- Fail closed on unknown schema IDs or missing fields.
- Verify parent hash chain for receipts.
- Verify checkpoint state hashes.
- Validate bundle manifest hashes and file sizes.
