# Credits

Fuel Protocol's own code is in this repository. The exercise library and drawings come from these open projects. Thank you to their authors.

## Exercise photos, steps and muscles: free-exercise-db

- Source: [github.com/yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db)
- License: [The Unlicense](https://unlicense.org) (public domain)
- Used for: 876 exercises in `public/exercises.json` (names, steps, main and helper muscles, equipment, level) and the two photos per exercise served from `/lib/<id>/` (resized; not in this repository). Built by `scripts/build-library.mjs`.

## Exercise drawings: Everkinetic

- Source: [github.com/everkinetic/data](https://github.com/everkinetic/data), drawings by Greg Priday ([everkinetic.com](http://everkinetic.com))
- License: [Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/)
- Used for: the line drawings served from `/lib/ek/<number>.svg` (not in this repository), and the steps and muscles of the exercises in `public/exercises.json` whose id starts with `ek_`.
- Changes: the white background layer of each drawing was removed, the start and end drawings were combined into one SVG that switches between them, and the lines are shown light on the dark theme. These adapted drawings are shared under the same CC BY-SA 4.0 license. Built by `scripts/build-everkinetic.mjs`.

## Muscle map: MuscleMap

- Source: [github.com/melihcolpan/MuscleMap](https://github.com/melihcolpan/MuscleMap) by Melih Colpan
- License: MIT (the full notice is next to the artwork in `public/index.html`)
- Used for: the front and back body drawing on the muscle map, converted from its Swift source.

## Demo clips

The demo clips in programs come from the programs you import and stay on your own deployment (`public/media/`, not in this repository).
