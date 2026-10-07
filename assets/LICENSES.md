# Sample assets

If this folder is missing, or `VIBE_FILTER_ASSETS` points at an empty folder, the synthesizer plays the same parts itself: drums become oscillators, and the room falls back to the Freeverb in `music.js`. Vinyl crackle is still synthesized.

Total WAV size is 11552792 bytes (59 files). Instrument notes, drums, and impulse responses are 48 kHz, 16-bit. Drums and impulse responses are mono. Synthwave is synthesized in `music.js` and does not add a sample bank. The flute bank was removed; no style plays it.

## Source

Rendered General MIDI notes from FluidR3_GM, published by Benjamin Gleitzman in the midi-js-soundfonts project.

- Index and license statement: http://gleitz.github.io/midi-js-soundfonts/
- File prefix: https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/
- Repository: https://github.com/gleitz/midi-js-soundfonts/tree/gh-pages/FluidR3_GM
- That page says the Fluid set is generated from FluidR3_GM.sf2 and released under Creative Commons Attribution 3.0.
- The soundfont itself is Frank Wen’s Fluid (R3). Frank Wen’s readme releases Fluid under the MIT license and asks for credit when a public bank is made from it: https://www.member.keymusician.com/Member/FluidR3_GM/README.html
- The midi-js-soundfonts software and README are MIT, copyright 2012 Benjamin Gleitzman: https://github.com/gleitz/midi-js-soundfonts/blob/gh-pages/LICENSE.txt

Attribution: Fluid (R3) SoundFont by Frank Wen. Note renders from Benjamin Gleitzman’s midi-js-soundfonts (CC BY 3.0), generated from FluidR3_GM.sf2.

The downloaded files were mp3. They were converted here to 48 kHz mono 16-bit WAV and the mp3s were removed. Pitch gaps between the sampled notes are filled by resampling at playback.

## Banks

| Folder | General MIDI instrument | MIDI notes kept | Bytes | Used for |
| --- | --- | --- | ---: | --- |
| `ep/` | electric_piano_1 | 36–84, every 3rd | 5107684 | Lo-fi chord bed, and the lo-fi lead |
| `mute/` | electric_guitar_muted | 48–84, every 3rd | 1997814 | Lo-fi counter-line |
| `bass/` | electric_bass_finger | 28–49, every 3rd | 1843824 | Lo-fi walking bass, and the sustained bass in Ambient and Arp |
| `celesta/` | celesta | 72–96, every 3rd | 1728702 | Ambient chord glints, and the ambient lead attack |
| `cym/` | reverse_cymbal | 60 only | 211278 | Section riser in Ambient and Arp |

## Drums

One-shots from the Sonic Pi sample pack, converted here from FLAC to 48 kHz mono 16-bit WAV and trimmed to the hit. Sonic Pi’s sample README says the files are from Freesound and were placed in the public domain under CC0:

https://github.com/sonic-pi-net/sonic-pi/blob/dev/etc/samples/README.md

Raw files: `https://github.com/sonic-pi-net/sonic-pi/raw/dev/etc/samples/<name>.flac`

CC0 1.0: http://creativecommons.org/publicdomain/zero/1.0/

| File | Sonic Pi name | Freesound author | Bytes | Used for |
| --- | --- | --- | ---: | --- |
| `drums/kick.wav` | drum_bass_soft | menegass 100052 | 51918 | Kick, round-robin A |
| `drums/kick-1.wav` | drum_bass_hard | menegass 100051 | 59598 | Kick, round-robin B |
| `drums/snare.wav` | drum_snare_soft | menegass 100059 | 29838 | Snare, round-robin A |
| `drums/snare-1.wav` | drum_snare_hard | menegass 100058 | 40398 | Snare, round-robin B |
| `drums/hat.wav` | drum_cymbal_closed | menegass 100053 | 17358 | Closed hat |
| `drums/open.wav` | drum_cymbal_open | menegass 100055 | 115278 | Open hat and section accent |
| `drums/rim.wav` | perc_snap | SoundCollectah 109400 | 21224 | Breakdown sidestick |
| `drums/shaker.wav` | perc_swash | qubodup 60009 | 25124 | Section B shaker |

## Impulse responses

Three trimmed rooms from Conner’s IR Library, MIT, copyright 2022 Conner.

- Repository: https://github.com/itsmusician/IR-Library
- License: https://github.com/itsmusician/IR-Library/blob/main/License.md
- The README says the library is free to use under the MIT license.

Each file was converted to 48 kHz mono 16-bit and faded so the tail fits the convolver (hall 1.25 s, room 0.85 s, hotel 1.05 s). The dry signal is not delayed. The wet tail is a half-rate convolution of a mono mix, with the right side delayed about 11 ms.

| File | Source recording | Bytes | Used for |
| --- | --- | ---: | --- |
| `ir/hall.wav` | Rooms/Commercial/Hotels/Ballrooms/Orlando Ballroom PA Mono.wav | 120078 | Ambient and Synthwave room |
| `ir/room.wav` | Hardware/2004 Digital Piano/2004 Digital Piano Tone Click Reverb Room 1.wav | 81738 | Lo-fi |
| `ir/hotel.wav` | Rooms/Commercial/Hotels/Guest Rooms/Hotel Room 1 XY (Balloon).wav | 100938 | Arp |

## Full license text: IR Library (MIT)

```
Copyright (c) 2022 Conner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Pronouncing dictionary

`cmudict/cmudict.dict` is the CMU Pronouncing Dictionary. It is used to turn lyric words into ARPABET. The file is not public domain. Carnegie Mellon University distributes it under a BSD-style 2-clause license (copyright 1993–2015), included at `cmudict/LICENSE`.

- Source: https://github.com/cmusphinx/cmudict
- Commit: 74790861f652b15e4ac49015a90074ad62a27690

If that file is missing, the singer falls back to a small letter-to-sound table in `voice.js` and does not crash. The dictionary is not part of the WAV byte total above.
