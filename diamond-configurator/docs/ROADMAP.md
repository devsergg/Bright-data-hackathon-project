# Roadmap: from foundation to production realism

## Done (this foundation)
- Parametric, carat-accurate gem geometry for 10 cuts, unit-tested (closed, outward, planar, weight).
- Real-time BVH ray-traced diamonds: Fresnel, TIR, Sellmeier dispersion, Beer–Lambert colour.
- ASET-style light-performance analysis and click-to-trace light paths.
- Procedural settings, metals and lighting presets, Rhino GLB contract and scripts, exports, share links.

## Next: realism
1. **Calibrate against photographs.** Photograph graded reference stones (D/G/J colour; Excellent
   vs Good cut) in a light tent, then match `COLOR_GRADES` absorption values, the studio preset and
   `exposure`. Same for metal F0 colours against real samples.
2. **Photographic HDRIs.** Add 2–3 CC0 studio HDRIs (Poly Haven `studio_small_09`, `photo_studio_loft_hall`)
   in `public/hdri/` and register them in `HDRI_PRESETS`. `bakeHDRI()` already handles conversion.
3. **Path-traced "HQ render" button.** Use `three-gpu-pathtracer` for a progressive, fully path-traced
   still (caustics, metal–stone interreflection, soft shadows) at checkout or for sharing.
4. **True fancy-shape facet patterns.** Princess chevron pavilion, radiant 70-facet, cushion "crushed ice"
   vs antique, and elongated-shape pavilion angle compensation (reduces the bow-tie; the light analysis
   shows the current bow-tie leakage on ovals/pears). Or load cutter-supplied stone models (`GEM_*`).
5. **Inclusions / clarity.** Render SI-grade inclusions as small absorbing/scattering volumes in the BVH
   pass, or keep clarity informational (most retailers do).
6. **Fluorescence and lab-grown options** (UV-preset environment, strain patterns are invisible face-up).
7. **Temporal accumulation.** When the camera is still, jitter rays and accumulate frames for
   anti-aliased facet edges and smoother fire.

## Next: Rhino integration
1. Model the core head library around `SEAT_center_*` markers (see RHINO_PIPELINE.md).
2. Grasshopper definition → one head per stone size; pick the nearest head at runtime.
3. Optional: **Rhino.Compute** server for fully parametric settings (shank taper, cathedral height, band
   profile) generated on demand. Or `rhino3dm.js` to read `.3dm` directly in the browser.
4. DRACO / meshopt compression (`gltf-transform optimize`) and a DRACOLoader in `rhinoSetting.ts`.

## Next: commerce
1. **Pricing engine:** stone price grid (cut × carat band × colour × clarity), or a live feed from a
   supplier (RapNet, Nivoda, VDB). Metal price = band volume × alloy density × spot price + labour.
   The band volume is already computable from the merged metal geometry.
2. **Inventory matching:** "show real stones close to this design" (search by cut, carat ±0.05, colour,
   clarity, and proportion ranges; the generator can render the exact certified proportions).
3. Cart and checkout (Shopify app or headless storefront). `RingConfig` JSON is the line-item payload.
4. **Production hand-off:** export JSON + stone OBJ → CAD technician → Rhino → resin print →
   cast. Add an engraving preview (text on the inside of the band).
5. Analytics: track which shapes, metals and settings people configure.

## Performance notes
- High quality traces 3 × 8 bounces per stone pixel. It runs well on desktop GPUs and recent phones.
  `quality=low` uses 4 bounces and single-path dispersion.
- Melee always use 5 bounces and fast dispersion; they are tiny on screen.
- If a page has many large stones (e.g. a three-stone ring), consider half-resolution gem rendering
  plus upsampling.
