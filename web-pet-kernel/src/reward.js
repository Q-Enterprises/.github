export function computeReward(prev, next) {
  // Terminal handling
  if (prev?.alive && next?.alive === false) return -100;

  // Penalize bad regimes; reward improvements
  const dh = prev.hunger - next.hunger; // hunger decreasing is good
  const de = next.energy - prev.energy;
  const dc = next.cleanliness - prev.cleanliness;
  const dj = next.joy - prev.joy;

  // Base delta reward
  let r = 0.25 * dh + 0.2 * de + 0.15 * dc + 0.4 * dj;

  // Regime penalties (nonlinear)
  if (next.hunger >= 85) r -= 3;
  if (next.energy <= 20) r -= 3;
  if (next.cleanliness <= 25) r -= 2;
  if (next.joy <= 25) r -= 2;

  // Mood change bonus/penalty
  if (prev.mood !== next.mood) {
    if (next.mood === "happy") r += 2;
    if (next.mood === "distressed") r -= 2;
  }

  return round3(r);
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}
