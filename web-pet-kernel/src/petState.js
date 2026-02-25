export class PetState {
  constructor() {
    // Deterministic sim time (seconds), not wall-clock.
    this.t = 0;

    // Core stats (0..100)
    this.hunger = 10; // higher = worse
    this.energy = 90; // lower = worse
    this.cleanliness = 80; // lower = worse
    this.joy = 70; // lower = worse

    this.alive = true;
    this.causeOfDeath = null;

    // Derived
    this.mood = "ok"; // ok | happy | sad | distressed | sleepy | filthy | starving | dead
    this.lastMood = this.mood;
  }

  tick(dt) {
    if (!this.alive) return;

    this.t += dt;

    // Drift dynamics (tunable, deterministic)
    this.hunger = clamp(this.hunger + dt * 0.9, 0, 100);
    this.energy = clamp(this.energy - dt * 0.6, 0, 100);
    this.cleanliness = clamp(this.cleanliness - dt * 0.25, 0, 100);
    this.joy = clamp(this.joy - dt * 0.15, 0, 100);

    // Second-order coupling (still deterministic)
    if (this.hunger > 75) this.joy = clamp(this.joy - dt * 0.35, 0, 100);
    if (this.energy < 25) this.joy = clamp(this.joy - dt * 0.25, 0, 100);
    if (this.cleanliness < 35) this.joy = clamp(this.joy - dt * 0.2, 0, 100);

    this.lastMood = this.mood;
    this.mood = this.deriveMood();

    // Death conditions (simple but meaningful)
    if (this.hunger >= 100) this.die("starvation");
    if (this.energy <= 0) this.die("exhaustion");
    // Optional: illness from filth
    if (this.cleanliness <= 0 && this.joy < 10) this.die("neglect");
  }

  feed(amount = 25) {
    if (!this.alive) return;
    this.hunger = clamp(this.hunger - amount, 0, 100);
    // Eating improves joy modestly
    this.joy = clamp(this.joy + amount * 0.12, 0, 100);
  }

  rest(amount = 25) {
    if (!this.alive) return;
    this.energy = clamp(this.energy + amount, 0, 100);
    // Rest improves joy slightly
    this.joy = clamp(this.joy + amount * 0.06, 0, 100);
  }

  clean(amount = 25) {
    if (!this.alive) return;
    this.cleanliness = clamp(this.cleanliness + amount, 0, 100);
    // Being clean improves joy
    this.joy = clamp(this.joy + amount * 0.08, 0, 100);
  }

  play(amount = 20) {
    if (!this.alive) return;
    // Joy up, energy down, cleanliness down a bit
    this.joy = clamp(this.joy + amount * 0.9, 0, 100);
    this.energy = clamp(this.energy - amount * 0.5, 0, 100);
    this.cleanliness = clamp(this.cleanliness - amount * 0.2, 0, 100);
    this.hunger = clamp(this.hunger + amount * 0.15, 0, 100);
  }

  die(cause) {
    this.alive = false;
    this.causeOfDeath = cause;
    this.lastMood = this.mood;
    this.mood = "dead";
  }

  deriveMood() {
    if (!this.alive) return "dead";

    const flags = {
      starving: this.hunger >= 85,
      sleepy: this.energy <= 20,
      filthy: this.cleanliness <= 25,
      sad: this.joy <= 25,
    };

    // Priority: death handled earlier; then critical multi-need
    const criticalCount = Object.values(flags).filter(Boolean).length;
    if (criticalCount >= 2) return "distressed";
    if (flags.starving) return "starving";
    if (flags.sleepy) return "sleepy";
    if (flags.filthy) return "filthy";
    if (flags.sad) return "sad";
    if (
      this.joy >= 70 &&
      this.hunger < 40 &&
      this.energy > 50 &&
      this.cleanliness > 50
    )
      return "happy";
    return "ok";
  }

  snapshot() {
    return {
      t: round3(this.t),
      alive: this.alive,
      causeOfDeath: this.causeOfDeath,
      hunger: round3(this.hunger),
      energy: round3(this.energy),
      cleanliness: round3(this.cleanliness),
      joy: round3(this.joy),
      mood: this.mood,
    };
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}
