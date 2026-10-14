/** Exact damped-spring step: independent of frame rate and keeps momentum on reversal. */
export type SpringState = { position: number; velocity: number };

export function stepSidebarSpring(state: SpringState, target: number, seconds: number): SpringState {
  if (seconds <= 0) return state;
  const frequency = target === 1 ? 22 : 27;
  const damping = target === 1 ? 0.84 : 1;
  const offset = state.position - target;
  const decay = Math.exp(-damping * frequency * seconds);
  if (damping === 1) {
    const coefficient = state.velocity + frequency * offset;
    return {
      position: target + (offset + coefficient * seconds) * decay,
      velocity: (state.velocity - frequency * coefficient * seconds) * decay,
    };
  }
  const angular = frequency * Math.sqrt(1 - damping * damping);
  const coefficient = (state.velocity + damping * frequency * offset) / angular;
  const sine = Math.sin(angular * seconds), cosine = Math.cos(angular * seconds);
  const displacement = offset * cosine + coefficient * sine;
  return {
    position: target + displacement * decay,
    velocity: decay * (angular * (-offset * sine + coefficient * cosine) - damping * frequency * displacement),
  };
}
