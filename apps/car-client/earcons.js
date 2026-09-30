/**
 * Short, non-startling cues. Routine events are heard, not spoken.
 * Each agent gets a stable pitch offset so the driver learns who is who.
 */
const SHAPES = {
  started: { notes: [523], dur: 0.09, gain: 0.05 },
  file_edit: { notes: [440], dur: 0.05, gain: 0.03 },
  progress: { notes: [494], dur: 0.06, gain: 0.035 },
  finished: { notes: [659, 880], dur: 0.12, gain: 0.06 },
  needs_you: { notes: [740, 587, 740], dur: 0.12, gain: 0.07 },
  error: { notes: [330, 262], dur: 0.16, gain: 0.07 },
  mode: { notes: [880], dur: 0.04, gain: 0.03 },
};

export class Earcons {
  constructor(context) {
    this.context = context;
    this.offsets = new Map();
    this.nextOffset = 0;
  }

  /** Stable per-agent detune so two agents never sound identical. */
  offsetFor(agentId) {
    if (!agentId) return 1;
    if (!this.offsets.has(agentId)) {
      const steps = [1, 1.19, 0.84, 1.33, 0.75];
      this.offsets.set(agentId, steps[this.nextOffset % steps.length]);
      this.nextOffset += 1;
    }
    return this.offsets.get(agentId);
  }

  play(kind, agentId) {
    const shape = SHAPES[kind] ?? SHAPES.progress;
    const detune = this.offsetFor(agentId);
    const now = this.context.currentTime;
    shape.notes.forEach((freq, index) => {
      const start = now + index * shape.dur;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = "sine";
      osc.frequency.value = freq * detune;
      // Soft attack and release keep cues below speech and never startle.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(shape.gain, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + shape.dur);
      osc.connect(gain);
      gain.connect(this.context.destination);
      osc.start(start);
      osc.stop(start + shape.dur + 0.02);
    });
  }
}
