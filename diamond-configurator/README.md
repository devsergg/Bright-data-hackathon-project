# Ring Studio — custom diamond ring configurator

A browser configurator for engagement and wedding rings in which **every diamond is
ray-traced in real time against its true facet geometry**: Fresnel reflection,
total internal reflection, per-wavelength dispersion (fire) and body-colour absorption.
Built to take ring settings modelled in **Rhino** (GLB export) while staying fully usable
with its own procedural settings.

```bash
cd diamond-configurator
npm install
npm run dev          # http://localhost:5173
npm test             # geometry, carat-weight, optics and light-return tests
npm run build        # static site in dist/ — host anywhere (Netlify, Vercel, S3, Shopify app proxy…)
```

URL options: `?quality=low|medium|high` and `?still` (turntable off). The full design
is kept in the URL hash, so every configuration is a shareable link.

## What's built

| Area | Where | Notes |
|---|---|---|
| **Gem geometry** | `src/gems/` | 10 cuts. Exact 57-facet round brilliant built from proportions (table %, crown/pavilion angles, girdle, star, lower-half), mapped onto oval, cushion, princess, radiant, pear, marquise and heart outlines. Step-cut generator for emerald/asscher (exact planar trapezoids, natural keel). |
| **Carat → size** | `src/gems/build.ts` | Volume integrated from the closed mesh × 3.52 mg/mm³. 1.00 ct ideal round = **6.46 mm** (trade reference 6.4–6.5); 1 ct emerald 1.4:1 = 7.05 × 5.04 mm. A deeper cut correctly looks smaller face-up. |
| **Diamond shader** | `src/render/diamondMaterial.ts` | GPU BVH ray tracing (three-mesh-bvh) through the real facets, up to 10 internal bounces with Fresnel energy splitting, Sellmeier IOR per R/G/B channel, Beer–Lambert colour (D–K, fancy colours). Same shader drives instanced melee. |
| **Light performance** | `src/gems/lightPerformance.ts` | ASET/DiamCalc-style analysis: brightness, light return, leakage, contrast, fire, plus an ASET-colour map. Updates live as proportions change. Click the stone to draw an actual light path. |
| **Lighting** | `src/render/environments.ts` | Procedural HDR light rooms (studio light tent, boutique spots, daylight, candlelight, office). Sharp cube for gems, PMREM for metal. Drop-in support for `.hdr` files. |
| **Metals** | `src/render/metals.ts` | Platinum, palladium, 14k/18k yellow, rose, rhodium white gold. Linear F0 colours from measured data. Polished or satin. |
| **Settings** | `src/ring/parts.ts`, `assembly.ts` | Comfort-fit band from US size, 4/6-prong, bezel, halo, pavé shoulders, matching wedding band (plain, half pavé, eternity). |
| **Rhino GLBs** | `src/ring/rhinoSetting.ts`, `rhino/`, `public/models/` | Naming contract (`METAL_*`, `GEM_*`, `SEAT_center_<mm>`), metre→mm auto-detect, orientation-proof seat markers, stone-fit warnings. A sample GLB is included. |
| **Exports** | `src/export/exporters.ts` | Stone OBJ/STL (exact facets, mm) for Rhino, ring GLB, order spec JSON, PNG snapshot, share link. |

## How the realism works

1. **Correct geometry first.** A diamond's look is set by its facet angles. The generator
   places every meetpoint analytically, so each bezel and pavilion main is an exact plane
   (tested to 1e-6 mm). Proportions are the same numbers on a GIA/AGS report.
2. **Physically based light transport.** For each pixel the shader enters the stone with
   Snell refraction, follows internal reflections through the actual triangles, and at
   each surface splits energy by the exact dielectric Fresnel equations. Light can only
   escape below the 24.4° critical angle, which is what makes diamonds bright.
3. **Dispersion.** R, G and B use their own refractive index from diamond's Sellmeier
   equation (n_D = 2.417, B–G dispersion 0.044). High quality traces three separate paths.
4. **Lighting that flatters diamonds.** Brilliance needs broad bright sources, scintillation
   needs contrast, fire needs small hard sources. The studio preset is modelled on a
   jewellery-photography light tent, with black cards and a camera reflection.

## Docs

- [`docs/RHINO_PIPELINE.md`](docs/RHINO_PIPELINE.md) — modelling conventions, the naming contract, export scripts, round-tripping stones.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — next steps toward production realism and commerce.

## Project layout

```
src/
  units.ts                 constants: density, carat, Sellmeier IOR, ring sizes
  state.ts                 RingConfig (one serialisable design), store, share links
  main.ts                  wiring: state → assembly → viewer → panel
  gems/                    outlines, brilliant + step generators, build, colour, light analysis
  render/                  diamond shader, environments, metals, viewer
  ring/                    procedural parts, assembly, Rhino GLB loader
  ui/                      panel, shape icons (drawn from real geometry), styles
  export/                  OBJ / STL / GLB / JSON
rhino/                     Rhino 8 Python scripts (export, seat marker, import stone)
tools/                     sample GLB generator (exercises the Rhino contract)
public/models/             GLB settings + manifest.json
public/hdri/               optional photographic HDRIs
tests/                     vitest
```
