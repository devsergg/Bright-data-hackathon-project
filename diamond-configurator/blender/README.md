# Lumen Solitaire: Blender hero renders

One design, built and lit in Blender (Cycles path tracing) for realistic
showcase images.

| | |
|---|---|
| Centre stone | 1.75 ct round brilliant, ideal cut: 7.78 × 7.78 × 4.77 mm, table 56%, crown 34.5°, pavilion 40.8°, 57 facets. Exact geometry from the configurator's gem generator (`assets/center.obj`). |
| Head | Six tapered claws (0.92 → 0.66 mm), two gallery rails, culet 0.9 mm above the band |
| Hidden halo | 18 × 1.07 mm melee (≈0.005 ct each) under the girdle, three between each pair of claws, tilted 55° outward, beaded frame |
| Shoulders | Cathedral arches rising from the band into the halo frame |
| Band | US size 6 (16.51 mm inside), comfort fit, tapering from 2.1 × 1.75 mm at the top to 1.8 × 1.5 mm at the base |
| Metal | Platinum 950, measured reflectance (linear F0 0.673, 0.637, 0.585), roughness 0.075 |

## Files

| File | What it is |
|---|---|
| `lumen_solitaire.py` | Builds the whole scene from code: ring, materials, lighting, camera. Change a parameter at the top and re-run. |
| `lumen_solitaire.blend` | The studio shot saved as a Blender file. Saved with Blender 5.2; open with 5.2 or newer. |
| `assets/center.obj`, `assets/melee.obj` | Stones exported from the configurator (`npx tsx tools/export-gem.ts round 1.75 out.obj`) |
| `renders/` | Final images |

## Rendering

```bash
# with Blender installed
blender -b -P blender/lumen_solitaire.py -- --shot studio --samples 1024 --res 2400x1800 --out renders/studio.png
# or with the bpy module (pip install bpy)
python blender/lumen_solitaire.py --shot velvet --out renders/velvet.png
```

The script picks the GPU automatically (Metal on Apple Silicon, then OptiX/CUDA/HIP) and
falls back to CPU. On an M1 Max a 1600×1200 frame at 384 samples takes about 3 minutes; the
first run after a Blender update spends an extra minute or two compiling Metal kernels.

Noise controls, already set:
- OpenImageDenoise with albedo + normal passes for final renders, and in the viewport from
  sample 1 (Z → Rendered stays clean while you orbit).
- Refractive caustics are off. Light focused through the stone onto the floor is the main
  firefly source, and the stone's own fire comes from camera rays, so it is unaffected.
  Pass `--caustics` to turn them back on (needs far more samples).
- Indirect clamp 8 and filter-glossy 1.0 to tame the remaining hot paths.

For a hero still, raise `--samples` to 1024–2048; the fine coloured speckle in the stone
(fire) settles as samples rise.

## Lighting, shot by shot

Diamonds show whatever surrounds them. Brilliance needs large bright sources,
scintillation needs dark areas for contrast, and fire needs small, hard sources.
Each setup is built around that.

**Studio (white light tent).** A clean e-commerce look. There is an overhead
softbox, a front fill, two side strips and a rim. Three black flags out of frame
put contrast into the crown, and two pin-point sun lamps (0.6°) add fire. A
glossy white acrylic sweep gives the soft reflection and contact shadow.

**Velvet (boutique).** Dark garnet velvet with a sheen layer. Every light that
shapes the ring uses **light linking**: it illuminates only the ring collection.
That lets large softboxes reflect in the stone and the platinum while the set stays
dark. Small hard spots give fire, and one separate soft spot pools light on the
velvet.

**Face-up (macro).** The camera looks straight down at the table, f/22 at 62 mm.
Eight jewellery-store spots at 45–57° elevation surround it, with a dark disc on
the camera axis that stands in for the photographer. That disc forms the dark
arrows pattern of an ideal cut, the same "obstruction" zone that ASET imaging
shows in blue.

## How the diamond material works

Blender's Glass BSDF has no dispersion input, so the material adds three glass
lobes with pure red, green and blue tints. Each lobe has diamond's own refractive
index for that wavelength, from its Sellmeier equation: 2.412 at 640 nm, 2.425 at
540 nm and 2.442 at 460 nm. The path tracer picks one lobe at random at each
bounce. Paths that mix channels cancel out, so each colour band refracts at its
own angle, and that produces true spectral fire. Light paths allow 32
transmission and 24 glossy bounces, so light can reflect many times inside the
stone before it leaves.

## Taking it further

- Add a photographic studio HDRI to the world for richer metal reflections.
- Render a 120-frame turntable (`Camera` on a circle, or rotate `Ring`) for the site's product page.
- Model engraving and hallmarks (PT950) on the inside of the band for close-ups.
- Swap `assets/center.obj` for any cut: `npx tsx tools/export-gem.ts oval 1.5 blender/assets/center.obj`.
