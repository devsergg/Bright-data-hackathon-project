# Photographic HDRIs (optional)

Drop equirectangular `.hdr` files here (2k is plenty), e.g. CC0 studio HDRIs from
https://polyhaven.com/hdris/studio, then register them in `HDRI_PRESETS`
(`src/render/environments.ts`). `bakeHDRI()` converts them to the sharp cube map
used by the diamond shader and the PMREM used by metals.
