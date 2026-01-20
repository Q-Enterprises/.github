import { createHash } from "node:crypto";
import { stat, readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const PROTOCOL = "parkers-sandbox/ledger/v1";
const CHECKPOINT_SCHEMA = "parkers-sandbox/checkpoint/v1";
const MANIFEST_SCHEMA = "parkers-sandbox/bundle.manifest/v1";
const GENESIS_PARENT_HASH =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";
const EVENT_ORDER = [
  "INPUT_RECORDED",
  "ENGINE_TICK",
  "CONSTRAINT_SOLVE",
  "COLLISION",
  "CHECKPOINT",
  "REPLAY_FINAL",
];

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNumber(value) {
  if (!Number.isFinite(value)) {
    throw new Error("Non-finite number in payload.");
  }
  return Object.is(value, -0) ? 0 : value;
}

function normalizeValue(value) {
  if (typeof value === "number") return normalizeNumber(value);
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => [key, normalizeValue(value[key])]);
    return Object.fromEntries(entries);
  }
  return value;
}

function canonicalStringify(value) {
  const normalized = normalizeValue(value);
  return JSON.stringify(normalized);
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

async function sha256File(path) {
  const buffer = await readFile(path);
  return {
    hash: sha256Hex(buffer),
    bytes: buffer.length,
  };
}

function validateReceiptEnvelope(receipt) {
  if (receipt.protocol !== PROTOCOL) {
    throw new Error(`Unknown protocol: ${receipt.protocol}`);
  }
  if (!receipt.event_id) throw new Error("Missing event_id.");
  if (typeof receipt.frame !== "number" || receipt.frame < 0) {
    throw new Error("Invalid frame.");
  }
  if (!EVENT_ORDER.includes(receipt.event_type)) {
    throw new Error(`Unknown event_type: ${receipt.event_type}`);
  }
  if (!receipt.metadata?.idempotency_key) {
    throw new Error("Missing metadata.idempotency_key.");
  }
}

function assertEventOrder(receipts) {
  let lastFrame = -1;
  let lastOrderIndex = -1;
  for (const receipt of receipts) {
    if (receipt.frame < lastFrame) {
      throw new Error("Receipt frame order is not non-decreasing.");
    }
    const orderIndex = EVENT_ORDER.indexOf(receipt.event_type);
    if (receipt.frame !== lastFrame) {
      lastFrame = receipt.frame;
      lastOrderIndex = orderIndex;
      continue;
    }
    if (orderIndex < lastOrderIndex) {
      throw new Error("Receipt event order is not deterministic within frame.");
    }
    lastOrderIndex = orderIndex;
  }
}

async function readReceipts(path) {
  const content = await readFile(path, "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON at receipts line ${index + 1}.`);
      }
    });
}

function computeReceiptHash(receipt) {
  const canonical = canonicalStringify(receipt);
  return `sha256:${sha256Hex(canonical)}`;
}

async function verifyReceipts(receipts) {
  const seenIds = new Set();
  let parentHash = GENESIS_PARENT_HASH;
  for (const receipt of receipts) {
    validateReceiptEnvelope(receipt);
    if (seenIds.has(receipt.event_id)) {
      throw new Error(`Duplicate event_id: ${receipt.event_id}`);
    }
    seenIds.add(receipt.event_id);
    if (receipt.parent_hash !== parentHash) {
      throw new Error("Receipt parent_hash mismatch.");
    }
    parentHash = computeReceiptHash(receipt);
  }
  assertEventOrder(receipts);
  return parentHash;
}

async function verifyCheckpoints(root, checkpoints, receiptParentHashByFrame) {
  for (const checkpointEntry of checkpoints) {
    const checkpointPath = resolve(root, checkpointEntry.path);
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
    if (checkpoint.schemaId !== CHECKPOINT_SCHEMA) {
      throw new Error(`Unknown checkpoint schema: ${checkpoint.schemaId}`);
    }
    const stateHash = `sha256:${sha256Hex(canonicalStringify(checkpoint.state))}`;
    if (checkpoint.state_hash !== stateHash) {
      throw new Error(`Checkpoint state_hash mismatch: ${checkpointPath}`);
    }
    const expectedParentHash = receiptParentHashByFrame.get(checkpoint.frame);
    if (!expectedParentHash) {
      throw new Error(`Missing receipt hash for checkpoint frame: ${checkpoint.frame}`);
    }
    if (checkpoint.receipts_parent_hash !== expectedParentHash) {
      throw new Error(`Checkpoint receipts_parent_hash mismatch: ${checkpointPath}`);
    }
  }
}

function computeReceiptParentHashByFrame(receipts) {
  const map = new Map();
  let parentHash = GENESIS_PARENT_HASH;
  for (const receipt of receipts) {
    if (!map.has(receipt.frame)) {
      map.set(receipt.frame, parentHash);
    }
    parentHash = computeReceiptHash(receipt);
  }
  return map;
}

async function validateManifest(manifest, root) {
  if (manifest.schemaId !== MANIFEST_SCHEMA) {
    throw new Error(`Unknown manifest schema: ${manifest.schemaId}`);
  }
  if (!manifest.arc_id) throw new Error("Missing manifest arc_id.");
  if (!manifest.files?.receipts) throw new Error("Missing manifest files.receipts.");

  const manifestCopy = { ...manifest };
  delete manifestCopy.bundleSha256;
  const expectedBundleHash = sha256Hex(canonicalStringify(manifestCopy));
  if (manifest.bundleSha256 && manifest.bundleSha256 !== expectedBundleHash) {
    throw new Error("Manifest bundleSha256 mismatch.");
  }

  const filesToVerify = [];
  filesToVerify.push({ type: "receipts", entry: manifest.files.receipts });
  if (manifest.files.inputs) {
    filesToVerify.push({ type: "inputs", entry: manifest.files.inputs });
  }
  if (Array.isArray(manifest.files.checkpoints)) {
    manifest.files.checkpoints.forEach((entry) =>
      filesToVerify.push({ type: "checkpoint", entry })
    );
  }
  if (Array.isArray(manifest.files.metrics)) {
    manifest.files.metrics.forEach((entry) =>
      filesToVerify.push({ type: "metric", entry })
    );
  }

  for (const { entry } of filesToVerify) {
    if (!entry?.path) throw new Error("Manifest entry missing path.");
    const filePath = resolve(root, entry.path);
    const stats = await stat(filePath);
    const { hash, bytes } = await sha256File(filePath);
    if (entry.sha256 !== hash) {
      throw new Error(`Hash mismatch for ${entry.path}`);
    }
    if (entry.bytes !== stats.size) {
      throw new Error(`Byte count mismatch for ${entry.path}`);
    }
  }
}

async function loadManifest(root) {
  const manifestPath = join(root, "bundle.manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return { manifest, manifestPath };
}

async function main() {
  const root = resolve(process.argv[2] ?? ".");
  const { manifest } = await loadManifest(root);
  await validateManifest(manifest, root);

  const receiptsPath = resolve(root, manifest.files.receipts.path);
  const receipts = await readReceipts(receiptsPath);
  await verifyReceipts(receipts);

  const receiptParentHashByFrame = computeReceiptParentHashByFrame(receipts);
  if (Array.isArray(manifest.files.checkpoints)) {
    await verifyCheckpoints(root, manifest.files.checkpoints, receiptParentHashByFrame);
  }

  const checkpointDir = join(root, "checkpoints");
  try {
    await readdir(checkpointDir);
  } catch (error) {
    if (manifest.files.checkpoints?.length) {
      throw new Error("Checkpoint directory missing.");
    }
  }

  process.stdout.write("Ledger bundle verified.\n");
}

main().catch((error) => {
  process.stderr.write(`Verification failed: ${error.message}\n`);
  process.exit(1);
});
