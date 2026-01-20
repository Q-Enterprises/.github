import { interpretState } from "./interpreter.js";
import { computeReward } from "./reward.js";

export class RAGBridge {
  constructor(eventBus, petRef, opts = {}) {
    this.bus = eventBus;
    this.petRef = petRef; // must expose snapshot()

    this.lastEventId = 0;

    // Chapter state
    this.chapter = null;

    // Tuning knobs
    this.maxChapterSeconds = opts.maxChapterSeconds ?? 20;
    this.thresholds = {
      hungerBands: [40, 70, 85, 100],
      energyBands: [70, 30, 20, 0],
      cleanBands: [70, 40, 25, 0],
      joyBands: [70, 35, 25, 0],
    };

    // Listen to events to trigger chapter boundaries on actions
    this.bus.subscribe((evt) => this.onEvent(evt));
  }

  onEvent(evt) {
    // Only chapterize deterministic events (sim_t present)
    if (evt.sim_t == null) return;

    const s = this.petRef.snapshot();
    if (!s) return;

    // Start if needed
    if (!this.chapter) this.startChapter(s, evt.sim_t, "init");

    // Track significant events in chapter
    this.chapter.events.push(minEvent(evt));

    // If the event is an action, boundary now (close + start new)
    if (isAction(evt.type)) {
      this.closeChapter(s, evt.sim_t, `action:${evt.type}`);
      this.startChapter(s, evt.sim_t, `post:${evt.type}`);
    }
  }

  // Call from game loop periodically to boundary on time/threshold/mood
  pulse(sim_t) {
    const s = this.petRef.snapshot();
    if (!s) return null;

    if (!this.chapter) this.startChapter(s, sim_t, "pulse");

    const prev = this.chapter.lastSnapshot;
    const prevInterp = interpretState(prev);
    const nextInterp = interpretState(s);

    const timeExceeded =
      sim_t - this.chapter.startSimT >= this.maxChapterSeconds;
    const moodChanged = prev.mood !== s.mood;
    const urgencyChanged = prevInterp.urgency !== nextInterp.urgency;
    const crossed = this.crossedThreshold(prev, s);
    const died = prev.alive && !s.alive;

    if (died || moodChanged || urgencyChanged || crossed || timeExceeded) {
      this.closeChapter(
        s,
        sim_t,
        died
          ? "death"
          : moodChanged
            ? "mood"
            : urgencyChanged
              ? "urgency"
              : crossed
                ? "threshold"
                : "time"
      );
      this.startChapter(s, sim_t, "continue");
      // Return the closed chapter payload for export pipelines if desired
      return this.lastClosedChapter ?? null;
    }

    this.chapter.lastSnapshot = s;
    return null;
  }

  exportBatchForEmbedding() {
    // Return the last closed chapter (single “Life Chapter”)
    const out = this.lastClosedChapter ?? null;
    this.lastClosedChapter = null;
    return out;
  }

  startChapter(snapshot, sim_t, reason) {
    this.chapter = {
      chapter_id: cryptoUUID(),
      startSimT: sim_t,
      startSnapshot: snapshot,
      lastSnapshot: snapshot,
      startReason: reason,
      events: [],
    };
  }

  closeChapter(endSnapshot, sim_t, reason) {
    const ch = this.chapter;
    if (!ch) return;

    const start = ch.startSnapshot;
    const end = endSnapshot;
    const startInterp = interpretState(start);
    const endInterp = interpretState(end);

    // SAR triplet: State, Action(s), Reward
    // Here, we treat chapter events as the “action trace”
    const reward = computeReward(start, end);

    const embedding_text = interpretChapterText(
      ch,
      startInterp,
      endInterp,
      reward,
      reason
    );

    this.lastClosedChapter = {
      chapter_id: ch.chapter_id,
      window: {
        start_t: start.t,
        end_t: end.t,
        duration_s: round3(end.t - start.t),
        boundary_reason: reason,
        start_reason: ch.startReason,
      },
      sar: {
        state: start,
        actions: ch.events.filter(
          (e) => isAction(e.type) || e.type === "agent_command"
        ),
        reward,
        next_state: end,
      },
      trajectory: {
        start_mood: start.mood,
        end_mood: end.mood,
        start_urgency: startInterp.urgency,
        end_urgency: endInterp.urgency,
        priorities_end: endInterp.priorities,
        alive_end: end.alive,
        cause_of_death: end.causeOfDeath,
      },
      summary: endInterp.text,
      embedding_text,
      metadata: {
        context_role: "petsim_kernel",
        lora_tags: ["physicspetcorerank8"],
        sim_time: { start: start.t, end: end.t },
      },
    };

    this.chapter = null;
  }

  crossedThreshold(a, b) {
    return (
      band(a.hunger, this.thresholds.hungerBands) !==
        band(b.hunger, this.thresholds.hungerBands) ||
      band(a.energy, this.thresholds.energyBands) !==
        band(b.energy, this.thresholds.energyBands) ||
      band(a.cleanliness, this.thresholds.cleanBands) !==
        band(b.cleanliness, this.thresholds.cleanBands) ||
      band(a.joy, this.thresholds.joyBands) !==
        band(b.joy, this.thresholds.joyBands)
    );
  }
}

function isAction(type) {
  return type === "player_action" || type === "agent_action";
}

function minEvent(evt) {
  return {
    id: evt.id,
    sim_t: evt.sim_t,
    type: evt.type,
    payload: evt.payload,
    meta: evt.meta,
  };
}

function interpretChapterText(ch, startInterp, endInterp, reward, reason) {
  const actions = ch.events
    .filter(
      (e) =>
        e.type === "player_action" ||
        e.type === "agent_action" ||
        e.type === "agent_command"
    )
    .map((e) => `${e.type}:${JSON.stringify(e.payload)}`)
    .slice(0, 8);

  return [
    `Life Chapter ${ch.chapter_id}`,
    `Window: t=${ch.startSnapshot.t}s → t=${ch.lastSnapshot.t}s (boundary=${reason})`,
    `Start: ${startInterp.text}`,
    `End: ${endInterp.text}`,
    `Actions: ${actions.length ? actions.join(" | ") : "none"}`,
    `Reward: ${reward}`,
  ].join("\n");
}

function band(v, bands) {
  // Returns index of first band >= v, else last
  for (let i = 0; i < bands.length; i += 1) if (v <= bands[i]) return i;
  return bands.length;
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function cryptoUUID() {
  // Browser-native UUID if available
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Fallback (not cryptographically strong; fine for local ids)
  return "xxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
