# Liebezeit sound: what is wired, and how

All of it recorded by Mike. The masters live in `liebezeit/audio/sfx/` as wav
and are gitignored; the browser loads the compressed set in
`liebezeit/audio/fx/`, which is 624KB against 4.7MB of wav.

## What plays, and when

| sound | fires |
|---|---|
| `start` | the ignition, on the title screen, on the first gesture. Starting a run fades it out under the music |
| `engine` | continuous. Playback rate and level follow the speedo |
| `pass` | **before** each overtake, so its drop lands as you go past. See below |
| `chain1`–`chain8` | each link of the chain, climbing the ladder |
| `chain_top` | past the octave, where the ladder holds |
| `hit` | contact, scaled by how hard |
| `kerb` | continuous, while a wheel is on the rumble strip (0.90 to 1.05 road-widths out) |
| `verge` | continuous, once you are off on the grass (past 1.05) |
| `finish` | crossing the line |
| `timeout` | the clock reaching zero |

Not recorded, and not needed: thunder, totality and the dog. Those moments are
already in the track. `chain_break` was recorded and then dropped: after a hit
it added nothing you could hear over the hit itself.

## The chain ladder is the second set

Mike recorded the chain twice. The second set, the files ending in `a`, is the
one in use. The manifest maps the code names onto them, so `chain1` loads
`chain1a.mp3` and the game code never mentions the letter. The nine originals
(`chain1`–`chain8`, `chain_top`) and `chain_break` are unused and can go.

## Turning it off

**S** on a keyboard, or the **SFX ON / OFF** box under RETRY on the pause card
if you are on a phone. Either mutes the effects and leaves the music playing. Every effect goes through
one gain node, so muting is a single ramp rather than chasing down each loop,
and the loops keep running silently so nothing has to be rebuilt when it comes
back. The state is announced on screen and again on the pause card. S used to be
the brake in the undocumented WASD scheme; it cannot be both, so the brake is
the down arrow and the pad, as advertised.

## Two things the code measures instead of being told

**Leading silence.** Every decoded buffer is scanned for its first audible
sample and playback starts there. That absorbs both the silence at the top of a
recording and the priming delay an mp3 decoder adds, so a one-shot fires when
it is asked to rather than a few milliseconds late. Measured on the current
set: 22ms on `pass`, 11ms on `finish`, under 2ms on everything else.

**The pass sync point.** `pass.wav` has to *start before* the overtake, because
the moment the sound drops away is the moment you go by. The drop is found by
walking back from the loudest point to the last frame still near it, which is
then nudged onto Mike's measured 0.90s by `Sfx.passTrim`. That figure becomes
the lead time: each car is armed when its time-to-overtake, from the closing
speed, falls to that. Currently 0.878s of lead. Change the recording and the
timing follows it; only `passTrim` is a typed-in number.

Two whooshes at once, at most. Three is mud. A pass already in the air is faded
out if you hit the car instead, because that overtake is not going to happen.

## Formats, and why they are not all the same

`engine`, `kerb` and `verge` are continuous loops and stay lossless wav at
22kHz mono, because a lossy loop ticks once every cycle where the encoder
padding sits. Each was cut to a whole number of waveform cycles with the
material that naturally follows blended into the head, so the seam measures
about 1.5x a typical sample-to-sample step, which is inaudible. Everything else
is a one-shot and is mp3 at 128k.

## If you replace a file

Drop the new wav in `audio/sfx/`, re-encode into `audio/fx/` at the same name
and extension, and it will be picked up. Keep the three loops as wav. Nothing
in the code hardcodes a duration.
