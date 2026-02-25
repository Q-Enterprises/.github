export class EventBus {
  constructor() {
    this.events = [];
    this.subscribers = [];
    this._nextId = 1;
  }

  emit(type, payload, meta = {}) {
    const evt = {
      id: this._nextId++,
      // Caller should pass sim time for determinism; keep wall time optional.
      sim_t: meta.sim_t ?? null,
      wall_ts: meta.wall_ts ?? Date.now(),
      type,
      payload,
      meta: {
        source: meta.source ?? "system",
        // Freeform tags: lora, prompt role, agent id, etc.
        tags: meta.tags ?? {},
      },
    };

    this.events.push(evt);
    for (const fn of this.subscribers) fn(evt);
    return evt;
  }

  subscribe(fn) {
    this.subscribers.push(fn);
    return () => {
      this.subscribers = this.subscribers.filter((f) => f !== fn);
    };
  }

  getEventsSince(id = 0) {
    return this.events.filter((e) => e.id > id);
  }
}
