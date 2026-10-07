# Credits and third-party licenses

The Vibe Filter source code (`*.js`, `public/`, the launcher) is MIT-licensed, copyright 2026 Relaximus; see [LICENSE](LICENSE).

Everything in `assets/` comes from third parties and keeps its own license. All of it allows redistribution. More technical notes (which notes were kept, how files were converted, byte sizes) are in [assets/LICENSES.md](assets/LICENSES.md).

The app runs without `assets/`: if the folder is missing, drums and instruments are synthesized, reverb falls back to a built-in Freeverb, and the singer uses a small built-in letter-to-sound table instead of the dictionary.

## Instrument samples: `assets/ep/`, `assets/mute/`, `assets/bass/`, `assets/celesta/`, `assets/cym/`

- **What:** single notes of General MIDI electric piano 1, muted electric guitar, finger bass, celesta and reverse cymbal.
- **Source:** Fluid (R3) SoundFont by **Frank Wen**, rendered to audio by **Benjamin Gleitzman** in [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts/tree/gh-pages/FluidR3_GM).
- **License:** the midi-js-soundfonts Fluid set is released under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/us/). Frank Wen's original Fluid (R3) SoundFont is released under the MIT license with a request for credit ([readme](https://www.member.keymusician.com/Member/FluidR3_GM/README.html)).
- **Attribution:** *Fluid (R3) SoundFont by Frank Wen. Note renders from Benjamin Gleitzman's midi-js-soundfonts (CC BY 3.0), generated from FluidR3_GM.sf2.*
- **Changes:** converted from MP3 to 48 kHz mono 16-bit WAV; only some notes kept (pitches in between are filled by resampling).

## Drum one-shots: `assets/drums/`

- **Source:** the [Sonic Pi sample pack](https://github.com/sonic-pi-net/sonic-pi/blob/dev/etc/samples/README.md), whose sounds come from Freesound.
- **License:** [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain dedication).
- **Changes:** converted from FLAC to 48 kHz mono 16-bit WAV and trimmed.

| File | Sonic Pi name | Original Freesound sound |
| --- | --- | --- |
| `kick.wav` | drum_bass_soft | [menegass #100052](https://freesound.org/people/menegass/sounds/100052/) |
| `kick-1.wav` | drum_bass_hard | [menegass #100051](https://freesound.org/people/menegass/sounds/100051/) |
| `snare.wav` | drum_snare_soft | [menegass #100059](https://freesound.org/people/menegass/sounds/100059/) |
| `snare-1.wav` | drum_snare_hard | [menegass #100058](https://freesound.org/people/menegass/sounds/100058/) |
| `hat.wav` | drum_cymbal_closed | [menegass #100053](https://freesound.org/people/menegass/sounds/100053/) |
| `open.wav` | drum_cymbal_open | [menegass #100055](https://freesound.org/people/menegass/sounds/100055/) |
| `rim.wav` | perc_snap | [SoundCollectah #109400](https://freesound.org/people/SoundCollectah/sounds/109400/) |
| `shaker.wav` | perc_swash | [qubodup #60009](https://freesound.org/people/qubodup/sounds/60009/) |

## Room reverbs (impulse responses): `assets/ir/`

- **Source:** [Conner's IR Library](https://github.com/itsmusician/IR-Library).
- **License:** MIT, Copyright (c) 2022 Conner ([License.md](https://github.com/itsmusician/IR-Library/blob/main/License.md); full text also in `assets/LICENSES.md`).
- **Changes:** converted to 48 kHz mono 16-bit, trimmed and faded.

| File | Original recording |
| --- | --- |
| `hall.wav` | Rooms/Commercial/Hotels/Ballrooms/Orlando Ballroom PA Mono.wav |
| `room.wav` | Hardware/2004 Digital Piano/2004 Digital Piano Tone Click Reverb Room 1.wav |
| `hotel.wav` | Rooms/Commercial/Hotels/Guest Rooms/Hotel Room 1 XY (Balloon).wav |

## Pronouncing dictionary: `assets/cmudict/`

- **What:** the CMU Pronouncing Dictionary, used to turn lyric words into speech sounds.
- **Source:** [cmusphinx/cmudict](https://github.com/cmusphinx/cmudict), commit `74790861f652b15e4ac49015a90074ad62a27690`.
- **License:** BSD-style 2-clause license, Copyright (C) 1993-2015 Carnegie Mellon University. The full license is included at [`assets/cmudict/LICENSE`](assets/cmudict/LICENSE).

## Not included

- **FFmpeg** is required but is not part of this repository. Install it yourself (for example `brew install ffmpeg`); it is distributed under its own LGPL/GPL licenses.
