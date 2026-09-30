/**
 * Shared audio context for speech cues. The web client cannot duck another
 * app's audio, and it deliberately adds no simulated driving/music noise.
 * Native media adapters remain a roadmap item.
 */
export class MediaLayer {
  constructor() {
    this.context = new AudioContext();
  }

  async start() {
    await this.context.resume();
  }

  // No-op in the browser: web pages cannot duck audio from other apps.
  duck(_on) {}

  stop() {}
}
