# Ledger Contract (v1)
*Substrate of Truth for Parker’s Sandbox.*

This document pins the **receipt envelope**, **hash chain**, **checkpoint format**, **canonical hashing rules**, and the **replay bundle layout**. Engine and agents must treat this as authoritative. Any deviation is a **BLOCK**.

---

## 0. Scope and non-negotiables

**Applies to:** deterministic simulation runs, replays, derived metrics, and agent “witness-only” analysis.

**Non-negotiables**
- Append-only ledger. No in-place edits.
- Deterministic event ordering. No unordered maps for event emission.
- Canonical hashing. Hashes must be reproducible across environments.
- Fail-closed validation. Unknown schema IDs, missing fields, or mismatched digests block.

---

## 1. Artifact taxonomy

### 1.1 Receipts (L3 truth)
Receipts are the atomic ledger records. Stored as **NDJSON** (`.ndjson`) where each line is one JSON object.

### 1.2 Checkpoints (L3 acceleration)
Checkpoints are periodic snapshots that accelerate replay. Checkpoints never replace receipts. They are verified against the receipt chain.

### 1.3 Derived metrics (L3 summaries)
Metrics are computed from receipts and checkpoints. They are non-authoritative summaries. They must cite their input bundle hash.

### 1.4 Agent outputs (L4 witness)
Agents may only read L3 exports. Agent outputs must cite evidence refs (ledger_event_id, frame ranges, and/or derived metrics).

---

## 2. Replay bundle layout (portable)

A replay bundle is a directory (or zip) containing:

```text
replays/
  <arc_id>/
    bundle.manifest.json
    receipts.ndjson
    checkpoints/
      checkpoint_000000.json
      checkpoint_000600.json
      ...
    inputs.ndjson                 # optional if inputs are modeled separately
    metrics/
      metrics.summary.json        # optional
      metrics.series.ndjson       # optional
    attest/
      attest.json                 # optional (build/run attestation)
      attest.sig                  # optional
```

### 2.1 `arc_id`

`arc_id` is the unique session identifier. It must be stable across exports for the same run.

Recommended: `ARC-YYYYMMDD-HHMMSS-<short_random_or_hash>`.

---

## 3. Canonical serialization and hashing

### 3.1 Canonical JSON serialization (JCS-ish)

All hashes in v1 are computed over **deterministically serialized JSON**.

Rules:

* UTF-8 encoding.
* Object keys sorted lexicographically at all levels.
* No whitespace significance.
* Arrays preserve original order.
* Numbers must be finite. Reject NaN, ±Infinity.
* Normalize `-0` to `0`.

This may be implemented with a stable-stringify library. If strict RFC 8785 is adopted later, it must be behind the same interface.

### 3.2 Hash algorithm

* `sha256` for receipt chaining and bundle verification.

Hash prefixing:

* Receipt hash values are represented as `sha256:<hex64>`.

---

## 4. Receipt envelope schema (v1)

**Protocol ID:** `parkers-sandbox/ledger/v1`

Receipts are a hash-linked chain. Each receipt carries the `parent_hash` of the previous receipt’s canonical hash.

### 4.1 Receipt type

```json
{
  "protocol": "parkers-sandbox/ledger/v1",
  "event_id": "string",
  "parent_hash": "sha256:<hex64>",
  "timestamp_iso": "RFC3339",
  "arc_id": "string",
  "frame": 0,
  "event_type": "INPUT_RECORDED|ENGINE_TICK|COLLISION|CONSTRAINT_SOLVE|CHECKPOINT|REPLAY_FINAL",
  "data": {},
  "metadata": {
    "runtime_profile": "string",
    "engine_build": "string",
    "idempotency_key": "string"
  }
}
```

### 4.2 Envelope rules (fail-closed)

* `protocol` must equal `parkers-sandbox/ledger/v1`.
* `parent_hash` must equal the canonical hash of the previous receipt in file order.
* `event_id` must be unique within an `arc_id`.
* `frame` must be a non-negative integer.
* `event_type` must be one of the enumerated constants. Unknown types block.
* `metadata.idempotency_key` must be stable (recommended `arc_id#event_id`).

### 4.3 Receipt ordering rules

Receipts must be ordered:

1. increasing by `frame`
2. within a frame, by a stable event order (see Section 5)

If your engine emits per-tick event arrays, the receipt format may store the array as a single `ENGINE_TICK` receipt or store each event as separate receipts. Either is valid if ordering is deterministic and consistent across runs.

---

## 5. Deterministic event ordering (engine-facing)

If events are emitted per frame, order MUST be stable.

Recommended per-frame order for physics:

1. `INPUT_RECORDED`
2. `ENGINE_TICK` (integration)
3. `CONSTRAINT_SOLVE` (floor/rim constraints)
4. `COLLISION`
5. `CHECKPOINT` (if emitted this frame)
6. `REPLAY_FINAL` (final frame only)

Within the `data` payload, if there is an `events: []` array, it must be emitted in a stable order with explicit ordering rules per event type.

---

## 6. Checkpoints (v1)

Checkpoints are optional but recommended. They accelerate replay and provide periodic integrity anchors.

### 6.1 Checkpoint file

`checkpoints/checkpoint_<frame>.json`

Shape:

```json
{
  "schemaId": "parkers-sandbox/checkpoint/v1",
  "arc_id": "string",
  "frame": 600,
  "state": {},
  "state_hash": "sha256:<hex64>",
  "receipts_parent_hash": "sha256:<hex64>"
}
```

Rules:

* `state_hash` is the canonical hash of `state`.
* `receipts_parent_hash` equals the receipt chain hash at the point the checkpoint was created (the parent hash after the last receipt included).
* Checkpoints must never contradict replay. If a checkpoint is loaded, replay must still validate receipt hashes and end state hash.

---

## 7. Bundle manifest (v1)

`bundle.manifest.json` binds the whole bundle.

```json
{
  "schemaId": "parkers-sandbox/bundle.manifest/v1",
  "arc_id": "string",
  "createdAtUtc": "RFC3339",
  "engine_build": "string",
  "runtime_profile": "string",
  "files": {
    "receipts": {
      "path": "receipts.ndjson",
      "sha256": "hex64",
      "bytes": 0
    },
    "inputs": {
      "path": "inputs.ndjson",
      "sha256": "hex64",
      "bytes": 0
    },
    "checkpoints": [
      { "path": "checkpoints/checkpoint_000600.json", "sha256": "hex64", "bytes": 0 }
    ],
    "metrics": [
      { "path": "metrics/metrics.summary.json", "sha256": "hex64", "bytes": 0 }
    ]
  },
  "bundleSha256": "hex64"
}
```

Rules:

* Missing optional sections are allowed, but if present must be valid.
* `bundleSha256` is the sha256 of the canonical manifest **excluding** `bundleSha256` itself (same signing pattern as attestations).

---

## 8. Replay validation algorithm (must-pass)

To accept a bundle as valid:

1. Verify manifest schemas and required fields.
2. Verify file hashes and byte counts.
3. Stream-verify receipt chain:

   * For each receipt line in order:

     * validate envelope schema
     * compute canonical hash of receipt
     * ensure `parent_hash` matches previous computed hash
4. If checkpoints exist:

   * validate each checkpoint schema
   * verify checkpoint `state_hash`
   * verify `receipts_parent_hash` matches the chain at the frame boundary
5. Run replay:

   * `init + inputs → identical state_hash at checkpoints and end` (engine-specific)
6. Any failure ⇒ **BLOCK**

---

## 9. Agent evidence rules (L4)

Agent outputs must reference:

* `ledger_event_id` for claims about specific actions or collisions, or
* `frame_range` for time-window claims, or
* `metric` entries derived from metrics files that themselves reference bundle hashes.

Agents must not mutate the ledger or propose in-place edits. Any “what-if” must be exported as a new branch plan.

---

## 10. Minimal examples

### 10.1 Genesis parent hash

The chain begins with a fixed parent hash:

* `parent_hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"`

### 10.2 `REPLAY_FINAL`

The final receipt should include:

* end-of-run summary
* final state hash
* counts (frames, collisions)
* reference to the manifest hash (optional)

---

## 11. Compatibility and versioning

* Schema IDs are immutable.
* Breaking changes require v2 schema IDs.
* The engine may evolve, but the ledger contract must remain stable once pinned.

---

## 12. Fail-closed checklist

BLOCK if:

* Unknown `protocol` or `schemaId`
* Missing required fields
* Non-finite numbers
* Receipt chain mismatch
* Manifest hash mismatch
* Checkpoint hash mismatch
* Replay end state hash mismatch
* Any file hash mismatch
