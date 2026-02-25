import { EventBus } from "./eventBus.js";
import { GameLoop } from "./gameLoop.js";
import { RAGBridge } from "./ragBridge.js";

const canvas = document.getElementById("game-canvas");
const terminalLog = document.getElementById("terminal-log");
const terminalInput = document.getElementById("terminal-input");

const bus = new EventBus();
const game = new GameLoop(canvas, bus);

// Bridge reads pet snapshots directly
const rag = new RAGBridge(
  bus,
  { snapshot: () => game.pet.snapshot() },
  { maxChapterSeconds: 20 }
);

// Terminal logging
bus.subscribe((evt) => {
  const line = document.createElement("div");
  const t =
    evt.sim_t != null
      ? `t=${evt.sim_t.toFixed(2)}s`
      : new Date(evt.wall_ts).toISOString();
  line.textContent = `[${t}] ${evt.type} :: ${JSON.stringify(evt.payload)}`;
  terminalLog.appendChild(line);
  terminalLog.scrollTop = terminalLog.scrollHeight;
});

// Periodic chapter pulse (context-window control)
setInterval(() => {
  const s = game.pet.snapshot();
  const closed = rag.pulse(s.t);
  if (closed) {
    // Emit an event that a chapter closed (good for streaming to backend)
    bus.emit(
      "telemetry_chapter",
      { chapter_id: closed.chapter_id },
      { sim_t: s.t, source: "telemetry" }
    );
    // Optional: auto-export to console for inspection
    console.log("Closed chapter:", closed);
  }
}, 500);

// Terminal → agent commands
terminalInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;

  const cmd = terminalInput.value.trim();
  if (!cmd) return;
  terminalInput.value = "";

  const s = game.pet.snapshot();

  bus.emit(
    "agent_command",
    { cmd },
    { sim_t: s.t, source: "terminal", tags: { agent_id: "human_terminal" } }
  );

  // Simple command parser
  if (cmd === "feed") act("feed", () => game.pet.feed(25));
  else if (cmd === "rest") act("rest", () => game.pet.rest(25));
  else if (cmd === "clean") act("clean", () => game.pet.clean(25));
  else if (cmd === "play") act("play", () => game.pet.play(20));
  else if (cmd === "export_chapter") {
    const chapter = rag.exportBatchForEmbedding();
    bus.emit("rag_export", { chapter }, { sim_t: s.t, source: "rag" });
    console.log("RAG export:", chapter);
  } else {
    bus.emit(
      "agent_error",
      { error: "Unknown command", cmd },
      { sim_t: s.t, source: "terminal" }
    );
  }

  function act(action, fn) {
    fn();
    const s2 = game.pet.snapshot();
    bus.emit(
      "agent_action",
      { action },
      { sim_t: s2.t, source: "terminal", tags: { agent_id: "human_terminal" } }
    );
  }
});

// Portal surface: LLM app can drive these safely
window.bus = bus;
window.game = {
  loop: game,
  rag,
  get state() {
    return game.pet.snapshot();
  },
  exportChapter: () => rag.exportBatchForEmbedding(),
  tama: {
    feed: (amt = 25, meta = {}) => {
      game.pet.feed(amt);
      const s = game.pet.snapshot();
      bus.emit(
        "agent_action",
        { action: "feed", amount: amt },
        { sim_t: s.t, source: meta.source ?? "portal", tags: meta.tags ?? {} }
      );
      return s;
    },
    rest: (amt = 25, meta = {}) => {
      game.pet.rest(amt);
      const s = game.pet.snapshot();
      bus.emit(
        "agent_action",
        { action: "rest", amount: amt },
        { sim_t: s.t, source: meta.source ?? "portal", tags: meta.tags ?? {} }
      );
      return s;
    },
    clean: (amt = 25, meta = {}) => {
      game.pet.clean(amt);
      const s = game.pet.snapshot();
      bus.emit(
        "agent_action",
        { action: "clean", amount: amt },
        { sim_t: s.t, source: meta.source ?? "portal", tags: meta.tags ?? {} }
      );
      return s;
    },
    play: (amt = 20, meta = {}) => {
      game.pet.play(amt);
      const s = game.pet.snapshot();
      bus.emit(
        "agent_action",
        { action: "play", amount: amt },
        { sim_t: s.t, source: meta.source ?? "portal", tags: meta.tags ?? {} }
      );
      return s;
    },
  },
};

game.start();
