"""
Original soundtrack for the Pars teaser, synthesized from scratch (no samples, no third-party music: free to use anywhere).

Cinematic tech in D minor at 120 BPM: warm detuned pads, a plucked 16th-note arpeggio with ping-pong delay, sub bass,
soft four-on-the-floor drums, FM bells for the 'intelligence' moments, risers into every chapter and impacts on the cuts.
The arrangement follows the video's cue sheet (out/cues.json: chapter starts, kinds and hit points, written by render.mjs),
and the tail is folded back into the start so the track loops seamlessly with the video.

Usage: python3 music/compose.py [cues.json] [out.wav]
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.signal import butter, fftconvolve, lfilter, sosfilt

SR = 48000
BPM = 120
BEAT = 60 / BPM
BAR = 4 * BEAT
RNG = np.random.default_rng(1389)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def n_(sec):
    return int(round(sec * SR))


# ── oscillators ────────────────────────────────────────────────
def polyblep(t, dt):
    dt = np.broadcast_to(dt, t.shape)
    out = np.zeros_like(t)
    m = t < dt
    x = t[m] / dt[m]
    out[m] = x + x - x * x - 1
    m = t > 1 - dt
    x = (t[m] - 1) / dt[m]
    out[m] = x * x + x + x + 1
    return out


def saw(freq, n, phase=0.0):
    """band-limited sawtooth (PolyBLEP); freq may be an array"""
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    ph = (phase + np.cumsum(f) / SR) % 1.0
    dt = f / SR
    return 2 * ph - 1 - polyblep(ph, dt)


def square(freq, n, phase=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    ph = (phase + np.cumsum(f) / SR) % 1.0
    dt = f / SR
    s = np.where(ph < 0.5, 1.0, -1.0)
    s += polyblep(ph, dt) - polyblep((ph + 0.5) % 1.0, dt)
    return s


def sine(freq, n, phase=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    return np.sin(2 * np.pi * (phase + np.cumsum(f) / SR))


def env_adsr(n, a, d, s, r, sustain_len=None):
    """attack/decay/sustain level/release in seconds; the note lasts n samples including release"""
    A, D, R = n_(a), n_(d), n_(r)
    S = max(0, n - A - D - R) if sustain_len is None else n_(sustain_len)
    e = np.concatenate([
        np.linspace(0, 1, max(A, 1), endpoint=False) ** 1.5,
        1 - (1 - s) * (1 - np.exp(-5 * np.linspace(0, 1, max(D, 1)))) / (1 - np.exp(-5)),
        np.full(S, s),
        s * np.exp(-5 * np.linspace(0, 1, max(R, 1))),
    ])
    if len(e) < n:
        e = np.concatenate([e, np.zeros(n - len(e))])
    return e[:n]


def lowpass(x, fc, q=0.707, order=2):
    fc = min(fc, SR * 0.45)
    sos = butter(order, fc, "low", fs=SR, output="sos")
    return sosfilt(sos, x)


def highpass(x, fc, order=2):
    sos = butter(order, fc, "high", fs=SR, output="sos")
    return sosfilt(sos, x)


def bandpass(x, lo, hi, order=2):
    sos = butter(order, [lo, min(hi, SR * 0.45)], "band", fs=SR, output="sos")
    return sosfilt(sos, x)


def sweep_lowpass(x, fcs, block=512):
    """time-varying 2-pole low-pass: cutoff per block, filter state carried across blocks"""
    y = np.zeros_like(x)
    zi = np.zeros(2)
    for i in range(0, len(x), block):
        fc = float(np.clip(fcs[min(i, len(fcs) - 1)], 40, SR * 0.45))
        b, a = butter(2, fc, "low", fs=SR)
        seg, zi = lfilter(b, a, x[i:i + block], zi=zi)
        y[i:i + block] = seg
    return y


# ── the mix bus ────────────────────────────────────────────────
class Mix:
    def __init__(self, seconds):
        self.n = n_(seconds)
        self.buses = {}

    def bus(self, name):
        if name not in self.buses:
            self.buses[name] = np.zeros((2, self.n))
        return self.buses[name]

    def add(self, name, sig, start, pan=0.0, gain=1.0):
        """mono or stereo signal at time start (s); pan -1..1 (equal power)"""
        b = self.bus(name)
        i = n_(start)
        if i >= self.n:
            return
        if sig.ndim == 1:
            l = math.cos((pan + 1) * math.pi / 4)
            r = math.sin((pan + 1) * math.pi / 4)
            sig = np.stack([sig * l, sig * r])
        j = min(self.n, i + sig.shape[1])
        if i < 0:
            sig, i = sig[:, -i:], 0
        b[:, i:j] += gain * sig[:, : j - i]


def reverb_ir(seconds=2.8, predelay=0.02, damp=6000, seed=7):
    r = np.random.default_rng(seed)
    n = n_(seconds)
    t = np.arange(n) / SR
    decay = np.exp(-6.9 * t / seconds)
    irs = []
    for ch in range(2):
        noise = r.standard_normal(n) * decay
        noise = lowpass(noise, damp)
        noise[: n_(predelay)] = 0
        irs.append(noise)
    ir = np.stack(irs)
    return ir / np.sqrt((ir ** 2).sum(axis=1, keepdims=True))


def reverb(x, ir, wet=0.3):
    out = np.zeros_like(x)
    for ch in range(2):
        out[ch] = fftconvolve(x[ch], ir[ch])[: x.shape[1]]
    return out * wet


def pingpong(x, time, feedback=0.42, taps=6, damp=5000):
    out = np.zeros_like(x)
    d = n_(time)
    src = x.mean(axis=0)
    g = 1.0
    for k in range(1, taps + 1):
        g *= feedback
        sh = d * k
        if sh >= x.shape[1]:
            break
        ch = k % 2
        tap = np.zeros(x.shape[1])
        tap[sh:] = src[:-sh] * g
        out[ch] += lowpass(tap, damp)
    return out


def compress(x, thresh_db=-18, ratio=3.0, attack=0.01, release=0.15, makeup_db=0.0):
    """feed-forward stereo-linked RMS compressor"""
    lvl = np.sqrt(np.mean(x ** 2, axis=0) + 1e-12)
    db = 20 * np.log10(lvl + 1e-9)
    over = np.maximum(0, db - thresh_db)
    gr = over * (1 - 1 / ratio)
    # smooth gain reduction (attack/release one-pole in blocks)
    blk = 64
    g = np.repeat(gr[::blk], blk)[: len(gr)]
    a_att = math.exp(-blk / (attack * SR))
    a_rel = math.exp(-blk / (release * SR))
    sm = np.zeros(len(g[::blk]))
    prev = 0.0
    for i, v in enumerate(g[::blk]):
        coef = a_att if v > prev else a_rel
        prev = coef * prev + (1 - coef) * v
        sm[i] = prev
    smf = np.repeat(sm, blk)[: x.shape[1]]
    gain = 10 ** ((-smf + makeup_db) / 20)
    return x * gain


def limit(x, ceiling=0.93):
    peak = np.max(np.abs(x), axis=0)
    blk = 32
    p = np.maximum.reduceat(peak, np.arange(0, len(peak), blk))
    need = np.minimum(1.0, ceiling / np.maximum(p, 1e-9))
    # release: let gain recover slowly
    sm = np.empty_like(need)
    cur = 1.0
    rel = math.exp(-blk / (0.08 * SR))
    for i, v in enumerate(need):
        cur = v if v < cur else rel * cur + (1 - rel) * v
        sm[i] = cur
    # look ahead one block
    sm = np.minimum(sm, np.concatenate([sm[1:], sm[-1:]]))
    g = np.repeat(sm, blk)[: x.shape[1]]
    return np.tanh(x * g / ceiling * 0.98) * ceiling


# ── instruments ────────────────────────────────────────────────
def pad_note(m, dur, bright=1.0):
    n = n_(dur + 2.2)
    f = mtof(m)
    sig = np.zeros((2, n))
    for ch, dets in enumerate(([-0.11, 0.07, 0.0], [0.11, -0.06, 0.02])):
        voice = sum(saw(f * 2 ** (c / 12), n, phase=RNG.random()) for c in dets) / 3
        voice = highpass(voice, 140)
        lfo = 0.5 + 0.5 * np.sin(2 * np.pi * 0.15 * np.arange(n) / SR + ch)
        voice = sweep_lowpass(voice, (900 + 1600 * bright) * (0.8 + 0.4 * lfo), block=1024)
        sig[ch] = voice
    return sig * env_adsr(n, 1.4, 0.8, 0.85, 2.0, sustain_len=max(0, dur - 2.2))


def pluck(m, dur=0.32, bright=1.0):
    n = n_(dur + 0.25)
    f = mtof(m)
    v = 0.6 * saw(f, n) + 0.4 * square(f * 1.002, n)
    cut = (700 + 4200 * bright) * np.exp(-np.arange(n) / (0.09 * SR)) + 380
    v = sweep_lowpass(v, cut, block=256)
    return v * env_adsr(n, 0.003, dur * 0.6, 0.0, 0.2)


def bass_note(m, dur):
    n = n_(dur + 0.05)
    f = mtof(m)
    v = sine(f, n) + 0.25 * lowpass(saw(f, n), 420)
    return np.tanh(1.4 * v) * env_adsr(n, 0.008, 0.25, 0.8, 0.06, sustain_len=max(0, dur - 0.33))


def kick(gain=1.0):
    n = n_(0.6)
    t = np.arange(n) / SR
    f = 46 + 110 * np.exp(-t * 28)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6.5)
    click = highpass(RNG.standard_normal(n) * np.exp(-t * 300), 1500) * 0.25
    return np.tanh(1.6 * (body + click)) * gain


def snare(gain=1.0):
    n = n_(0.45)
    t = np.arange(n) / SR
    noise = bandpass(RNG.standard_normal(n), 1200, 9000) * np.exp(-t * 16)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 22) * 0.5
    clap = np.zeros(n)
    for k, off in enumerate((0, 0.011, 0.023)):
        i = n_(off)
        burst = bandpass(RNG.standard_normal(n - i), 900, 5000) * np.exp(-np.arange(n - i) / SR * (60 if k < 2 else 18))
        clap[i:] += burst * 0.6
    return (noise * 0.7 + tone + clap) * gain


def hat(open_=False, gain=1.0):
    n = n_(0.35 if open_ else 0.08)
    t = np.arange(n) / SR
    v = highpass(RNG.standard_normal(n), 7000, order=4)
    return v * np.exp(-t * (9 if open_ else 55)) * gain


def bell(m, dur=1.6, gain=1.0):
    n = n_(dur)
    t = np.arange(n) / SR
    f = mtof(m)
    mod = np.sin(2 * np.pi * f * 3.5 * t) * 2.2 * np.exp(-t * 3.2)
    v = np.sin(2 * np.pi * f * t + mod) * np.exp(-t * 2.4)
    v += 0.25 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 4)
    return v * env_adsr(n, 0.002, 0.1, 1.0, 0.05) * gain


def riser(dur, gain=1.0):
    n = n_(dur)
    t = np.arange(n) / SR
    k = t / dur
    noise = RNG.standard_normal(n)
    out = np.zeros(n)
    blk = 1024
    for i in range(0, n, blk):
        c = 300 * (40 ** k[i])
        out[i:i + blk] = bandpass(noise[i:i + blk], c * 0.6, c * 1.6, order=1)
    tone = saw(110 * 2 ** (2.5 * k), n) * 0.12
    tone = sweep_lowpass(tone, 400 + 6000 * k ** 2)
    return (out * 0.9 + tone) * (k ** 2.2) * gain


def impact(gain=1.0):
    n = n_(3.0)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(42 + 70 * np.exp(-t * 12)) / SR) * np.exp(-t * 2.6)
    crash = highpass(RNG.standard_normal(n), 3000) * np.exp(-t * 2.5) * 0.25
    return np.tanh(1.3 * boom) * 0.9 * gain + crash * gain


def whoosh(dur=1.0, gain=1.0):
    n = n_(dur)
    t = np.arange(n) / SR
    k = t / dur
    env = np.sin(np.pi * k) ** 2
    out = np.zeros(n)
    noise = RNG.standard_normal(n)
    blk = 512
    for i in range(0, n, blk):
        c = 400 + 5000 * np.sin(np.pi * k[i])
        out[i:i + blk] = bandpass(noise[i:i + blk], c * 0.5, c * 1.5, order=1)
    return out * env * gain


# ── harmony ───────────────────────────────────────────────────
D_MINOR = {
    "Dm": {"pad": [62, 65, 69], "bass": 38, "arp": [62, 65, 69, 74]},
    "Bb": {"pad": [62, 65, 70], "bass": 34, "arp": [58, 62, 65, 70]},
    "F": {"pad": [60, 65, 69], "bass": 41, "arp": [60, 65, 69, 72]},
    "C": {"pad": [60, 64, 67], "bass": 36, "arp": [60, 64, 67, 72]},
    "Gm": {"pad": [62, 67, 70], "bass": 43, "arp": [62, 67, 70, 74]},
    "A": {"pad": [61, 64, 69], "bass": 45, "arp": [61, 64, 69, 73]},
}
PROG = {
    "main": ["Dm", "Bb", "F", "C"],
    "lift": ["Bb", "C", "Dm", "Dm"],
    "calm": ["Dm", "Gm", "Bb", "A"],
}
HOOK = [  # (beat offset in a 4-bar phrase, midi, beats)
    (0, 74, 1.5), (1.5, 72, 0.5), (2, 69, 2),
    (4, 77, 1.5), (5.5, 74, 0.5), (6, 70, 2),
    (8, 72, 1), (9, 69, 1), (10, 67, 1), (11, 65, 1),
    (12, 67, 1.5), (13.5, 64, 0.5), (14, 69, 2),
]


def section_plan(kind):
    """per-section arrangement switches"""
    return {
        "intro": dict(drums=0, arp=0.4, bass=0, pad=1.0, prog="calm", bells=1, bright=0.4),
        "stats": dict(drums=1, arp=0.8, bass=1, pad=0.8, prog="main", bells=0, bright=0.6),
        "overview": dict(drums=2, arp=1.0, bass=1, pad=0.7, prog="main", bells=0, bright=0.8),
        "product": dict(drums=2, arp=1.0, bass=1, pad=0.7, prog="main", bells=0, bright=0.9),
        "product2": dict(drums=2, arp=1.0, bass=1, pad=0.7, prog="lift", bells=0, bright=1.0),
        "ai": dict(drums=1, arp=0.8, bass=1, pad=0.9, prog="calm", bells=1, bright=0.7),
        "agents": dict(drums=1, arp=1.0, bass=1, pad=0.9, prog="calm", bells=1, bright=0.8),
        "capabilities": dict(drums=2, arp=1.0, bass=1, pad=0.8, prog="lift", bells=0, bright=1.0),
        "clients": dict(drums=2, arp=1.0, bass=1, pad=0.8, prog="main", bells=0, bright=1.0),
        "outro": dict(drums=0, arp=0.5, bass=0.6, pad=1.0, prog="main", bells=1, bright=0.5),
    }.get(kind, dict(drums=2, arp=1.0, bass=1, pad=0.7, prog="main", bells=0, bright=0.8))


def compose(cues, out_path):
    total = cues["duration"]
    tail = 4.0
    mix = Mix(total + tail)
    sections = cues["sections"]  # [{start, end, kind}]
    kicks = []

    def sect_at(t):
        for s in sections:
            if s["start"] <= t < s["end"]:
                return s
        return sections[-1]

    nbars = int(math.ceil(total / BAR))
    for b in range(nbars):
        t0 = b * BAR
        s = sect_at(t0 + 0.01)
        plan = section_plan(s["kind"])
        # position inside the section (bars) for builds
        bar_in = int(round((t0 - s["start"]) / BAR))
        sec_bars = max(1, int(round((s["end"] - s["start"]) / BAR)))
        prog = PROG[plan["prog"]]
        chord = D_MINOR[prog[b % 4]]
        si = sections.index(s)
        if bar_in == 0 and s["kind"] not in ("intro", "outro") and plan["drums"] >= 2:
            plan = dict(plan, drums=1, arp=plan["arp"] * 0.7)  # breathe on the title card, then the beat comes back
        fade_in = min(1.0, (t0 - s["start"]) / (BAR * 2) + 0.5) if s["kind"] in ("intro",) else 1.0
        last_bar = bar_in == sec_bars - 1

        # pad: one chord per bar, notes slightly staggered
        for i, m in enumerate(chord["pad"]):
            mix.add("pad", pad_note(m, BAR, plan["bright"]), t0 + i * 0.01, pan=(i - 1) * 0.5, gain=0.11 * plan["pad"] * fade_in)
        # bass
        if plan["bass"] > 0:
            if plan["drums"] >= 2:
                for k in range(8):  # 8ths with octave pop on the offbeats
                    m = chord["bass"] + (12 if k % 2 else 0)
                    mix.add("bass", bass_note(m, BEAT / 2 * 0.9), t0 + k * BEAT / 2, gain=0.12 * plan["bass"])
            else:
                mix.add("bass", bass_note(chord["bass"], BAR * 0.95), t0, gain=0.13 * plan["bass"])
        # arpeggio: 16ths up and down the chord over two octaves
        if plan["arp"] > 0:
            tones = chord["arp"] + [x + 12 for x in chord["arp"]]
            pattern = ([0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6, 4, 3, 1], [0, 4, 2, 5, 1, 4, 3, 6, 0, 4, 2, 5, 3, 7, 4, 2], [4, 3, 2, 1, 5, 4, 3, 2, 6, 5, 4, 3, 7, 5, 3, 1])[si % 3]
            for k in range(16):
                m = tones[pattern[k] % len(tones)]
                vel = 0.8 if k % 4 == 0 else 0.55
                mix.add("arp", pluck(m, 0.28, plan["bright"]), t0 + k * BEAT / 4, pan=0.35 * math.sin(k * 0.7), gain=0.16 * plan["arp"] * vel)
        # drums
        d = plan["drums"]
        if d >= 1:
            for k in range(4):
                if d >= 2 or k in (0, 2):
                    mix.add("kick", kick(), t0 + k * BEAT, gain=0.3)
                    kicks.append(t0 + k * BEAT)
            for k in range(8):
                mix.add("hat", hat(), t0 + k * BEAT / 2 + (0.012 if k % 2 else 0), pan=0.25, gain=(0.11 if k % 2 else 0.07) * (1 if d >= 2 else 0.6))
            if d >= 2:
                for k in (1, 3):
                    mix.add("snare", snare(), t0 + k * BEAT, gain=0.2)
                if bar_in % 2 == 1:
                    mix.add("hat", hat(open_=True), t0 + 3.5 * BEAT, pan=-0.2, gain=0.09)
                if last_bar:  # fill into the next section
                    for k in range(4):
                        mix.add("snare", snare(), t0 + 3 * BEAT + k * BEAT / 4, gain=0.1 + 0.04 * k)
        # bells: the hook over 4-bar phrases where the section asks for it
        if plan["bells"] and bar_in % 4 == 0:
            for off, m, ln in HOOK:
                if t0 + off * BEAT < s["end"]:
                    mix.add("bell", bell(m, ln * BEAT + 1.2), t0 + off * BEAT, pan=0.2 * math.sin(off), gain=0.09)

    # chapter transitions: riser into the cut, impact and whoosh on it
    for hit in cues.get("hits", []):
        t, kind = hit["t"], hit.get("kind", "chapter")
        if kind == "logo":
            mix.add("fx", riser(4.0), t - 4.0, gain=0.1)
            mix.add("fx", impact(), t, gain=0.3)
        elif kind == "chapter":
            mix.add("fx", riser(2.0), t - 2.0, gain=0.07)
            mix.add("fx", impact(), t, gain=0.2)
        elif kind == "whoosh":
            mix.add("fx", whoosh(1.0), t - 0.5, pan=0.0, gain=0.16)
        elif kind == "sparkle":
            for k, m in enumerate([86, 89, 93, 98]):
                mix.add("bell", bell(m, 1.2, 0.8), t + k * 0.09, pan=-0.5 + k * 0.33, gain=0.035)
        elif kind == "tick":  # a callout lands: one soft high note from the current chord
            s = sect_at(t)
            chord = D_MINOR[PROG[section_plan(s["kind"])["prog"]][int(t // BAR) % 4]]
            m = chord["arp"][int(round(t * 4)) % 4] + 24
            mix.add("bell", bell(m, 0.9, 0.6), t, pan=0.3 * math.sin(t), gain=0.03)
        elif kind == "click":  # the cursor clicks
            n = n_(0.04)
            c = highpass(RNG.standard_normal(n), 2500) * np.exp(-np.arange(n) / (0.006 * SR))
            mix.add("fx", c, t, gain=0.05)
            mix.add("fx", whoosh(0.6), t + 0.05, gain=0.06)
        elif kind == "scan":  # the AI layer sweeps the screen
            mix.add("fx", riser(1.8), t, gain=0.05)
            mix.add("fx", whoosh(1.6), t, gain=0.08)
        elif kind == "swell":  # a closing line
            mix.add("fx", riser(2.5), t - 2.0, gain=0.06)
            mix.add("fx", impact(), t + 0.5, gain=0.12)

    # sidechain: pad and arp breathe with the kick
    duck = np.ones(mix.n)
    rel = n_(0.28)
    shape = 1 - 0.55 * np.exp(-np.arange(rel) / (0.07 * SR))
    for t in kicks:
        i = n_(t)
        j = min(mix.n, i + rel)
        duck[i:j] = np.minimum(duck[i:j], shape[: j - i])
    for name in ("pad", "arp", "bass"):
        if name in mix.buses:
            mix.buses[name] *= duck if name != "bass" else (0.5 + 0.5 * duck)

    # effects
    ir = reverb_ir(2.8)
    arp = mix.bus("arp")
    arp_fx = arp + pingpong(arp, BEAT * 0.75, feedback=0.38, taps=5)
    send = mix.bus("pad") * 0.35 + arp_fx * 0.45 + mix.bus("bell") * 0.7 + mix.bus("snare") * 0.25 + mix.bus("fx") * 0.3
    wet = reverb(send, ir, wet=0.55)
    dry = (mix.bus("pad") + arp_fx + mix.bus("bell") + mix.bus("bass") * 1.0 + mix.bus("kick") + mix.bus("snare") + mix.bus("hat") + mix.bus("fx"))
    master = dry + wet
    master = highpass(master, 28, order=2)
    master = compress(master, thresh_db=-16, ratio=2.5, attack=0.015, release=0.2, makeup_db=2.0)

    # fold the tail into the start, so the end flows into the beginning when the video loops
    n = n_(total)
    out = master[:, :n].copy()
    tl = master[:, n:]
    out[:, : tl.shape[1]] += tl
    out = limit(out * 1.2, ceiling=0.9)

    pcm = (np.clip(out.T, -1, 1) * 32767).astype("<i2")
    import wave
    with wave.open(str(out_path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    peak = 20 * np.log10(np.max(np.abs(out)) + 1e-9)
    rms = 20 * np.log10(np.sqrt(np.mean(out ** 2)) + 1e-9)
    print(f"wrote {out_path}: {total:.1f} s, peak {peak:.1f} dBFS, rms {rms:.1f} dBFS")


if __name__ == "__main__":
    here = Path(__file__).resolve().parent.parent
    cues_path = Path(sys.argv[1]) if len(sys.argv) > 1 else here / "out" / "cues.json"
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else here / "out" / "music.wav"
    compose(json.loads(cues_path.read_text()), out_path)
