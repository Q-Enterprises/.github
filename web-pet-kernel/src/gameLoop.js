import { PetState } from "./petState.js";

export class GameLoop {
  constructor(canvas, eventBus) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.bus = eventBus;

    this.pet = new PetState();
    this.lastNow = performance.now();
    this.running = false;

    this.registerInput();
  }

  registerInput() {
    this.canvas.addEventListener("click", (e) => {
      // Simple click cycles an action: feed (you can make UI later)
      this.pet.feed(15);
      this.bus.emit(
        "player_action",
        { action: "feed", amount: 15, x: e.offsetX, y: e.offsetY },
        { sim_t: this.pet.snapshot().t, source: "player" }
      );
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "p") {
        this.pet.play(20);
        this.bus.emit(
          "player_action",
          { action: "play", amount: 20 },
          { sim_t: this.pet.snapshot().t, source: "player" }
        );
      }
      if (e.key === "c") {
        this.pet.clean(25);
        this.bus.emit(
          "player_action",
          { action: "clean", amount: 25 },
          { sim_t: this.pet.snapshot().t, source: "player" }
        );
      }
      if (e.key === "r") {
        this.pet.rest(25);
        this.bus.emit(
          "player_action",
          { action: "rest", amount: 25 },
          { sim_t: this.pet.snapshot().t, source: "player" }
        );
      }
    });
  }

  start() {
    this.running = true;
    requestAnimationFrame(this.step.bind(this));
  }

  step(now) {
    if (!this.running) return;

    const dt = (now - this.lastNow) / 1000;
    this.lastNow = now;

    // Tick simulation
    this.pet.tick(dt);

    this.render();
    requestAnimationFrame(this.step.bind(this));
  }

  render() {
    const ctx = this.ctx;
    const { width: W, height: H } = this.canvas;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, W, H);

    // Pet
    const s = this.pet.snapshot();
    ctx.fillStyle = s.alive ? "#c58b4e" : "#555";
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 40, 0, Math.PI * 2);
    ctx.fill();

    // HUD
    ctx.fillStyle = "#fff";
    ctx.font = "14px sans-serif";
    ctx.fillText(`t: ${s.t.toFixed(1)}s`, 16, 22);
    ctx.fillText(`mood: ${s.mood}`, 16, 42);
    ctx.fillText(`hunger: ${s.hunger.toFixed(1)}`, 16, 62);
    ctx.fillText(`energy: ${s.energy.toFixed(1)}`, 16, 82);
    ctx.fillText(`clean: ${s.cleanliness.toFixed(1)}`, 16, 102);
    ctx.fillText(`joy: ${s.joy.toFixed(1)}`, 16, 122);

    ctx.fillStyle = "#bbb";
    ctx.fillText("Controls: click=feed, p=play, c=clean, r=rest", 16, H - 16);

    if (!s.alive) {
      ctx.fillStyle = "#ffb3b3";
      ctx.font = "16px sans-serif";
      ctx.fillText(`DEAD (${s.causeOfDeath})`, W / 2 - 70, H / 2 + 70);
    }
  }
}
