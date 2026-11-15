// All sound is synthesised with WebAudio: no audio files, no network. One shared
// context, one master gain, short envelopes. Every call is safe before the first
// user gesture: the context resumes lazily on the first sound after a click.
let ctx = null;
let master = null;
let noiseBuffer = null;

function ensure() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const length = Math.floor(ctx.sampleRate * 0.5);
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return ctx;
}

function noise({ duration, filterType, frequency, q, gain, at = 0 }) {
  if (!ensure()) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = frequency;
  filter.Q.value = q || 1;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
  src.connect(filter).connect(amp).connect(master);
  src.start(t, Math.random() * 0.4);
  src.stop(t + duration + 0.02);
}

function tone({ frequency, endFrequency, duration, type, gain, at = 0 }) {
  if (!ensure()) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, t);
  if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, t + duration);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(amp).connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

// distance 0..1 scales the shot so far-away fire reads as distant.
export const sfx = {
  shot(kind, distance = 0) {
    const d = Math.max(0, Math.min(1, distance));
    const g = 0.9 * (1 - d * 0.75);
    if (kind === 'sniper') {
      noise({ duration: 0.32, filterType: 'lowpass', frequency: 900, gain: g });
      tone({ frequency: 140, endFrequency: 42, duration: 0.28, type: 'sine', gain: g * 0.9 });
    } else if (kind === 'smg') {
      noise({ duration: 0.09, filterType: 'bandpass', frequency: 1800, q: 0.8, gain: g * 0.8 });
      tone({ frequency: 190, endFrequency: 70, duration: 0.08, type: 'square', gain: g * 0.28 });
    } else if (kind === 'pistol') {
      noise({ duration: 0.11, filterType: 'bandpass', frequency: 1400, q: 0.8, gain: g * 0.85 });
      tone({ frequency: 170, endFrequency: 60, duration: 0.1, type: 'square', gain: g * 0.3 });
    } else {
      noise({ duration: 0.14, filterType: 'bandpass', frequency: 1100, q: 0.7, gain: g });
      tone({ frequency: 160, endFrequency: 55, duration: 0.13, type: 'square', gain: g * 0.35 });
    }
  },
  dryFire() {
    tone({ frequency: 1400, duration: 0.03, type: 'square', gain: 0.12 });
  },
  reload() {
    tone({ frequency: 900, duration: 0.04, type: 'square', gain: 0.14 });
    tone({ frequency: 620, duration: 0.04, type: 'square', gain: 0.14, at: 0.22 });
    tone({ frequency: 1100, duration: 0.05, type: 'square', gain: 0.16, at: 0.55 });
  },
  hit() {
    tone({ frequency: 2100, duration: 0.045, type: 'sine', gain: 0.22 });
  },
  kill() {
    tone({ frequency: 1900, duration: 0.06, type: 'sine', gain: 0.26 });
    tone({ frequency: 2600, duration: 0.09, type: 'sine', gain: 0.22, at: 0.06 });
  },
  hurt() {
    tone({ frequency: 110, endFrequency: 70, duration: 0.16, type: 'sawtooth', gain: 0.22 });
  },
  explosion(distance = 0) {
    const d = Math.max(0, Math.min(1, distance));
    noise({ duration: 0.9, filterType: 'lowpass', frequency: 420, gain: 1 - d * 0.6 });
    tone({ frequency: 90, endFrequency: 28, duration: 0.8, type: 'sine', gain: 0.9 * (1 - d * 0.5) });
  },
  grenadePin() {
    tone({ frequency: 2400, duration: 0.03, type: 'square', gain: 0.1 });
  },
  bounce() {
    tone({ frequency: 500, endFrequency: 300, duration: 0.05, type: 'sine', gain: 0.12 });
  },
  beep(final = false) {
    tone({ frequency: final ? 1500 : 1050, duration: final ? 0.3 : 0.09, type: 'sine', gain: 0.2 });
  },
  plant() {
    tone({ frequency: 700, duration: 0.08, type: 'sine', gain: 0.18 });
    tone({ frequency: 700, duration: 0.08, type: 'sine', gain: 0.18, at: 0.16 });
  },
  step(run) {
    noise({ duration: 0.05, filterType: 'lowpass', frequency: run ? 500 : 380, gain: run ? 0.1 : 0.07 });
  },
  roundWin() {
    [523, 659, 784].forEach((f, i) => tone({ frequency: f, duration: 0.16, type: 'triangle', gain: 0.2, at: i * 0.12 }));
  },
  roundLose() {
    [392, 330, 262].forEach((f, i) => tone({ frequency: f, duration: 0.18, type: 'triangle', gain: 0.18, at: i * 0.13 }));
  },
  buy() {
    tone({ frequency: 1200, duration: 0.05, type: 'sine', gain: 0.16 });
    tone({ frequency: 1700, duration: 0.07, type: 'sine', gain: 0.16, at: 0.05 });
  },
  denied() {
    tone({ frequency: 220, duration: 0.09, type: 'square', gain: 0.14 });
  },
};
