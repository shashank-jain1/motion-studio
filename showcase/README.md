# Motion and sound showcases

## Continuous Motion / One Sonic World

The 14-second film uses one persistent pearl sculpture, continuous movement, four chapters and a related sonic palette. Three quiet bridges carry decay and anticipation between four foreground accents, while preserving a short rest before the final signature.

- `continuity-film.mp4`: 1920×1080, 30 fps, 420 frames, H.264/AAC.
- `continuity-sheet.jpg`: moving and settled frames from the current film.
- `continuity-isolated.wav`: foreground effects only.
- `continuity-connected.wav`: the exact same foreground effects and gain, plus connecting textures.
- `continuity-cues.json`: source families, phrases and bridges.
- `continuity-export-review.json`: evidence from the exported audio.

All four foreground accents correlate with the decoded export at ≥0.996, with a maximum measured offset of 0.07 frames. All three bridges correlate at ≥0.983, within 0.06 frames. The sparse SFX-only mix measures −22.41 LUFS integrated and −0.97 dBTP. These checks establish timing and asset presence; the audio comparison is for judging the texture and connection by ear.

Recreate with `npm run showcase:continuity`. Render this editable project with `npm run showcase:continuity -- --project=continuous-motion-one-sonic-world-0dce --video-only`. Use `--2d` in a fresh project for the vector metamorphosis treatment. [Studio research](../docs/research/08-studio-motion-and-sonic-continuity.md) explains the design decisions.

## Motion Lab / One clock

Eight editable shots demonstrate the motion/SFX upgrade: type impact, magnetic deck, orbit landing, ribbon flight, hinged panels, vortex tunnel, chrome echoes and particle formation. This is an SFX-only lab so the motion accents are easy to inspect.

- `motion-lab-final.mp4`: 25.6 seconds, 1920×1080, 30 fps, 768 frames, H.264/AAC.
- `motion-lab-sheet.jpg`: moving and settled frames from all eight shots.
- `motion-lab-cues.json`: planned cue frames, layers and intentional silences.
- `motion-lab-export-review.json`: measured exported-waveform sync and loudness.
- `motion-lab-render.json`: output metadata and the editable project ID.

The checked export has 11 baked SFX cues. All 11 correlate with the decoded AAC at ≥0.996, with maximum measured timing offset 0.46 frames (15.3 ms). The sparse SFX-only mix measures −24.94 LUFS integrated and −1.06 dBTP; the true-peak ceiling limits gain. These measurements do not replace listening to the full video.

Recreate in a fresh project with `npm run showcase:motion`. Re-render this project with `npm run showcase:motion -- --project=motion-lab-choreography-6218 --video-only --final`. Recheck its exported audio with `--review-only` in place of the render flags.

See [the playbook](../docs/MOTION_PLAYBOOK.md) for authoring and [the skills audit](../docs/research/07-motion-skills-upgrade.md) for sources and remaining feature gaps.
