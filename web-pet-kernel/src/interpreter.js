export function interpretState(s) {
  if (!s)
    return {
      urgency: "UNKNOWN",
      priorities: [],
      text: "No state available.",
    };
  if (!s.alive) {
    return {
      urgency: "TERMINAL",
      priorities: [],
      text: `The pet is dead (cause: ${s.causeOfDeath}). No further actions are possible.`,
    };
  }

  const priorities = [];
  if (s.hunger >= 70) priorities.push("feed");
  if (s.energy <= 30) priorities.push("rest");
  if (s.cleanliness <= 40) priorities.push("clean");
  if (s.joy <= 35) priorities.push("play");

  const critical = [
    s.hunger >= 85,
    s.energy <= 20,
    s.cleanliness <= 25,
    s.joy <= 25,
  ].filter(Boolean).length;

  const urgency =
    critical >= 2
      ? "CRITICAL"
      : critical === 1
        ? "HIGH"
        : priorities.length >= 2
          ? "ELEVATED"
          : "STABLE";

  const text =
    `t=${s.t}s; mood=${s.mood}; ` +
    `hunger=${s.hunger}, energy=${s.energy}, cleanliness=${s.cleanliness}, joy=${s.joy}. ` +
    `Urgency=${urgency}. Priorities=${priorities.length ? priorities.join(", ") : "none"}.`;

  return { urgency, priorities, text };
}
