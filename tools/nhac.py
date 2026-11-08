"""
Upbeat background tracks for Đại Chiến Ốc Sên (copied from ../dua-bi/tools/nhac.py), composed and synthesised here (no samples, no third-party music, so no licence
question). 07/11, host's choice: "nhạc nền sôi động".

    python tools/nhac.py            -> public/audio/dua-bi-*.wav (mono 22 050 Hz, about 80 s each)

Each track: drums (kick, snare, hats), pumping bass, offbeat chord stabs, a 16th arpeggio and a lead melody made
from chord tones with a fixed seed, so a run always gives the same files. Form: intro 4 bars, A 16, B 8, A 16, end 4.
"""
import os
import wave

import numpy as np

SR = 22050
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'audio')

NOTE = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
        'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def chord(name, octave=4):
    """'Am' / 'F' / 'G' -> MIDI notes of the triad (root position) in the given octave."""
    minor = name.endswith('m')
    root = NOTE[name[:-1] if minor else name] + 12 * (octave + 1)
    return [root, root + (3 if minor else 4), root + 7]


def env(n, attack=0.005, decay=0.2, sustain=0.0, release=0.03):
    """Attack / exponential decay towards sustain / short release, n samples."""
    t = np.arange(n) / SR
    e = sustain + (1 - sustain) * np.exp(-t / max(decay, 1e-4))
    a = int(attack * SR)
    if a > 0:
        e[:a] *= np.linspace(0, 1, a)
    r = min(int(release * SR), n)
    if r > 0:
        e[-r:] *= np.linspace(1, 0, r)
    return e


def osc(kind, f, n, vib=0.0):
    """Additive (band-limited enough at these pitches) square / saw / triangle / sine."""
    t = np.arange(n) / SR
    ph = 2 * np.pi * f * t
    if vib:
        ph += vib * np.sin(2 * np.pi * 5.5 * t) * np.clip(t * 4 - 0.6, 0, 1)
    if kind == 'sine':
        return np.sin(ph)
    out = np.zeros(n)
    top = int(min(12, (SR / 2) // max(f, 1)))
    for k in range(1, top + 1):
        if kind == 'square' and k % 2 == 1:
            out += np.sin(k * ph) / k
        elif kind == 'saw':
            out += np.sin(k * ph) / k * (1 if k % 2 else -1)
        elif kind == 'tri' and k % 2 == 1:
            out += np.sin(k * ph) / (k * k) * (1 if (k // 2) % 2 == 0 else -1)
    return out


def kick():
    n = int(0.28 * SR)
    t = np.arange(n) / SR
    f = 48 + 110 * np.exp(-t / 0.035)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.11) * 1.0


def snare(rng):
    n = int(0.2 * SR)
    t = np.arange(n) / SR
    noise = np.diff(rng.uniform(-1, 1, n + 1))  # highpassed noise
    return (noise * 0.3 * np.exp(-t / 0.06) + np.sin(2 * np.pi * 190 * t) * 0.35 * np.exp(-t / 0.05))


def hat(rng, open_=False):
    n = int((0.16 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    noise = np.diff(np.diff(rng.uniform(-1, 1, n + 2)))
    return noise / 4 * (0.09 if open_ else 0.12) * np.exp(-t / (0.035 if open_ else 0.012))  # quiet: the hiss must not cover the tune


def add(buf, sig, at):
    i = int(at * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[:j - i]


# rhythm templates for one bar of lead, in eighths: (start, length); a bar has 8 eighths
RHYTHMS = [
    [(0, 1), (1, 1), (2, 2), (4, 1), (5, 1), (6, 2)],
    [(0, 2), (2, 1), (3, 1), (4, 2), (6, 1), (7, 1)],
    [(0, 1), (1, 1), (2, 1), (3, 1), (4, 3), (7, 1)],
    [(0, 3), (3, 1), (4, 1), (5, 1), (6, 2)],
    [(1, 1), (2, 1), (3, 2), (5, 1), (6, 2)],
]


def melody_bar(rng, ch, scale, prev, rhythm):
    """Notes for one bar: chord tones on strong eighths, scale steps in between, close to the previous note."""
    out = []
    tones = [n + 12 * k for n in ch for k in (1, 2)]  # chord tones an octave or two above the chord
    for s, ln in rhythm:
        pool = tones if s % 2 == 0 else [n for n in scale if 66 <= n <= 86]
        pool = sorted(pool, key=lambda n: abs(n - prev) + rng.uniform(0, 4))
        note = pool[0] if rng.random() < 0.6 else pool[min(len(pool) - 1, 1 + int(rng.integers(0, 3)))]
        out.append((s, ln, note))
        prev = note
    return out, prev


def track(name, bpm, prog_a, prog_b, key, minor, seed):
    rng = np.random.default_rng(seed)
    beat = 60 / bpm
    bar = 4 * beat
    e8 = beat / 2
    form = [('intro', 4), ('A', 16), ('B', 8), ('A', 16), ('end', 4)]
    bars = sum(n for _, n in form)
    total = bars * bar + 2.0
    drums = np.zeros(int(total * SR))
    bass = np.zeros_like(drums)
    stabs = np.zeros_like(drums)
    arp = np.zeros_like(drums)
    lead = np.zeros_like(drums)
    duck = np.ones_like(drums)

    steps = [0, 2, 3, 5, 7, 8, 10] if minor else [0, 2, 4, 5, 7, 9, 11]
    scale = [NOTE[key] + 12 * o + s for o in range(3, 8) for s in steps]
    K, S = kick(), snare(rng)
    duck_shape = 1 - 0.45 * np.exp(-np.arange(int(beat * SR)) / SR / 0.09)  # the pumping under each kick

    # the lead of an A section is written once, so A comes back the same (a tune you recognise)
    def write_lead(prog, n, seed2, up=0):
        r = np.random.default_rng(seed2)
        prev, phrase = 76, []
        motif = [RHYTHMS[int(r.integers(0, len(RHYTHMS)))] for _ in range(2)]
        for b in range(n):
            ch = chord(prog[b % len(prog)])
            rh = motif[b % 2] if b % 4 != 3 else RHYTHMS[int(r.integers(0, len(RHYTHMS)))]
            notes, prev = melody_bar(r, ch, scale, prev, rh)
            if b % 4 == 3:  # the end of a phrase lands on the root, held
                notes = notes[:-1] + [(notes[-1][0], 8 - notes[-1][0], ch[0] + 24)] if notes else notes
            phrase.append([(s, ln, nt + up) for s, ln, nt in notes])
        # bars 9-16 repeat 1-8 with the last phrase changed: verse / answer
        return phrase[:8] + phrase[:4] + phrase[12:16] if n == 16 else phrase

    lead_a = write_lead(prog_a, 16, seed + 1)
    lead_b = write_lead(prog_b, 8, seed + 2, up=0)

    t0, bi = 0.0, 0
    for sec, n in form:
        prog = prog_b if sec == 'B' else prog_a
        for b in range(n):
            at = t0 + b * bar
            ch = chord(prog[b % len(prog)])
            last = sec == 'end' and b == n - 1
            # drums: four on the floor, snare on 2 and 4, closed hats on eighths, open hat on the off-beats
            for q in range(4):
                if last and q > 0:
                    break
                add(drums, K, at + q * beat)
                i = int((at + q * beat) * SR)
                j = min(len(duck), i + len(duck_shape))
                duck[i:j] = np.minimum(duck[i:j], duck_shape[:j - i])
                if q in (1, 3) and sec != 'intro' or (sec == 'intro' and q == 3 and b % 2 == 1):
                    add(drums, S, at + q * beat)
                add(drums, hat(rng), at + q * beat)
                add(drums, hat(rng, open_=True), at + q * beat + e8)
            if sec in ('A', 'B') and b % 8 == 7:  # a snare roll into the next phrase
                for k in range(4):
                    add(drums, S * (0.5 + 0.15 * k), at + 3 * beat + k * beat / 4)
            if last:
                break
            # bass: root on eighths, octave up on the off-beats (pumping)
            root = ch[0] - 24
            for k in range(8):
                f = hz(root + (12 if k % 2 else 0))
                nn = int(e8 * 0.9 * SR)
                add(bass, osc('square', f, nn) * env(nn, 0.003, 0.12, 0.35, 0.02) * 0.32, at + k * e8)
            # chord stabs on the off-beats
            for q in range(4):
                nn = int(e8 * 0.8 * SR)
                sig = sum(osc('saw', hz(m + 12), nn) for m in ch) * env(nn, 0.002, 0.07, 0.0, 0.02) * 0.07
                add(stabs, sig, at + q * beat + e8)
            # arpeggio in sixteenths (from A on; the B section doubles it)
            if sec != 'intro':
                pat = [0, 1, 2, 1] if sec == 'A' else [0, 1, 2, 3]
                tones = ch + [ch[0] + 12]
                for k in range(16):
                    nn = int(beat / 4 * 0.9 * SR)
                    m = tones[pat[k % 4]] + 12
                    add(arp, osc('tri', hz(m), nn) * env(nn, 0.002, 0.05, 0.0, 0.01) * (0.09 if sec == 'A' else 0.13), at + k * beat / 4)
            # lead
            if sec in ('A', 'B'):
                for s, ln, m in (lead_a if sec == 'A' else lead_b)[b]:
                    nn = int(ln * e8 * SR * 0.95)
                    sig = (osc('square', hz(m), nn, vib=0.015) * 0.7 + osc('saw', hz(m), nn) * 0.3)
                    add(lead, sig * env(nn, 0.006, 0.35, 0.55, 0.04) * 0.2, at + s * e8)
            bi += 1
        t0 += n * bar

    mix = drums * 0.9 + (bass + stabs + arp) * duck + lead * (0.85 + 0.15 * duck)
    end = int((bars * bar + 0.6) * SR)
    mix = mix[:end]
    mix = np.tanh(mix * 1.4) / np.tanh(1.4)
    mix *= 0.89 / max(1e-6, np.max(np.abs(mix)))
    fade = int(0.01 * SR)
    mix[:fade] *= np.linspace(0, 1, fade)
    mix[-int(0.5 * SR):] *= np.linspace(1, 0, int(0.5 * SR))
    path = os.path.join(ROOT, name + '.wav')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype('<i2').tobytes())
    print(f'{path}  {len(mix) / SR:.0f} s  {os.path.getsize(path) / 1e6:.1f} MB')


if __name__ == '__main__':
    os.makedirs(ROOT, exist_ok=True)
    track('oc-sen-1-xung-tran', 146, ['Dm', 'Bb', 'C', 'Am'], ['Gm', 'Dm', 'Bb', 'C'], 'D', True, 91)
    track('oc-sen-2-tra-sua', 138, ['F', 'C', 'Dm', 'Bb'], ['Bb', 'C', 'Am', 'Dm'], 'F', False, 103)
    track('oc-sen-3-ca-phe', 150, ['Cm', 'Ab', 'Bb', 'Gm'], ['Ab', 'Bb', 'Cm', 'Cm'], 'C', True, 117)
