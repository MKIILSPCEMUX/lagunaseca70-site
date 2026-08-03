# Liebezeit — SFX list

For Mike to record or source. Same pattern as the Dark Star list. Everything
is Web Audio, decoded once at load, so keep them short and dry: the game adds
no reverb and the master track is already washy.

**Format:** WAV, 44.1kHz, mono is fine for everything except the engine loop.
Trim silence off the head of every file, the engine excepted. Name them as the
filename column and drop them in `liebezeit/audio/sfx/`.

---

## The one that matters most

| File | What it is | Length | Notes |
|---|---|---|---|
| `engine.wav` | Seamless engine loop, steady throttle | 1–2 s | **The single biggest thing missing.** Played continuously and pitch-shifted with speed, roughly 0.72x to 1.35x, so record it flat and mid-range. A real Nova at about 3,000rpm through a phone is perfect: we want lofi, not a sample library. Must loop with no click. |

Without this the game is silent apart from the track, and every other effect
below is decoration on top of nothing.

---

## Driving

| File | What it is | Length | Notes |
|---|---|---|---|
| `pass.wav` | Doppler whoosh as a car goes by | 0.4 s | Fires on every near miss. Will be played very often, so it must be quiet and not attention-seeking. Air, not tyres. |
| `hit.wav` | Contact with traffic | 0.5 s | The chain-breaker. Wants to be genuinely unpleasant: a dull crunch, low mid, no ring-out. |
| `verge.wav` | Off the tarmac, looping | 1 s | Gravel and grass roar. Loops while off the road, cross-faded in over about 150ms. |
| `kerb.wav` | Clipping the rumble strip | 0.2 s | Short, hard, repetitive. Optional but it makes the road edge readable by ear. |

## The chain

| File | What it is | Length | Notes |
|---|---|---|---|
| `chain1.wav` … `chain8.wav` | The eight rungs | 0.4 s each | **G# Dorian from G#4:** G#, A#, B, C#, D#, E#, F#, then G# an octave up. Anything that speaks quickly and sits above the mix: a struck bell, a plucked string, a short synth blip. Currently placeholder triangle tones and they sound it. |
| `chain_top.wav` | Past the octave | 0.6 s | Plays under the held top note once the chain runs past eight, so a long run keeps building. A shimmer, an octave double, or the same note through a long delay. |
| `chain_break.wav` | The chain resetting to zero | 0.5 s | A descending fall, or a tape-stop. Should feel like a loss without being punishing. |

## Moments

| File | What it is | Length | Notes |
|---|---|---|---|
| `thunder.wav` | Distant rumble | 2–3 s | Fires with each lightning strike in the rain, bars 29 to 38. Should sit low and far off, not crack. |
| `totality.wav` | The eclipse landing | 3–4 s | Bar 61, as the light goes. A swell or a drone rather than a hit. Optional, but the moment deserves it. |
| `finish.wav` | Crossing the line | 1.5 s | Bar 96. A cheer, a horn, a bark. |
| `bark.wav` | Kalinka at the finish | 0.5 s | Self-explanatory. Please use the real dog. |

## Interface

| File | What it is | Length | Notes |
|---|---|---|---|
| `start.wav` | Beginning a run | 0.5 s | Ignition and catch. |
| `timeout.wav` | Running out of time | 1 s | The failure sting. |

---

## Levels

Everything sits under the master track, which is the point. As a starting
mix, relative to the music at 1.0: engine 0.30, pass 0.14, hit 0.42, verge
0.22, chain notes 0.30, thunder 0.35, finish 0.45. I will tune by ear once
the files are in.

## Not needed

No skid or tyre squeal. The car does not slide any more, so a squeal would be
lying about what is happening.
