# Rhino → Ring Studio pipeline

The configurator already works without Rhino: it generates stones and simple settings
procedurally. Rhino is where **settings (heads, shanks, galleries, side stones)** get
designed to manufacturing quality. They load into the site as GLB files.

```
Rhino 8 (+ MatrixGold / RhinoGold optional)
  └─ model setting around a SEAT marker            rhino/make_seat.py
  └─ export GLB + register in manifest             rhino/export_for_web.py
        ↓
public/models/<id>.glb  +  public/models/manifest.json
        ↓
configurator: METAL_* get the shopper's metal, GEM_* get the diamond shader,
the configurable centre stone drops onto SEAT_center
```

## 1. Document setup

| Setting | Value | Why |
|---|---|---|
| Units | **Millimetres** | The site works in mm. Rhino's glTF export converts to metres and the loader converts back. |
| Origin | **Centre of the finger hole** | Procedural bands and wedding bands assume it. |
| Finger axis | **Rhino Y** | Becomes the configurator's Z. |
| Head direction | **Rhino +Z** | Becomes the configurator's +Y (up). |
| Stone length (north–south) | **Rhino Y** | Ovals, pears and marquises point along the finger. |

## 2. Naming contract

Set object names in Rhino's **Properties → Object → Name**:

| Name | Meaning |
|---|---|
| `METAL_<anything>` | Metal. Its material is replaced by the shopper's chosen metal and finish. Use as many as you like (`METAL_shank`, `METAL_head`, `METAL_gallery`). |
| `GEM_<anything>` | A fixed stone you modelled (side stones, melee, accents). Must be **closed**. Rendered with the ray-traced diamond shader. |
| `SEAT_center_<mm>` | Where the configurable centre stone goes. Create it with `make_seat.py`. The `<mm>` suffix is the stone width the head was made for (e.g. `SEAT_center_6.50`); the site warns when the shopper picks a size that doesn't fit. |
| `SEAT_side_<mm>` | Optional extra seats for configurable side stones (reserved). |

Unnamed visible objects are exported as metal, and the script warns about them.
Material-name fallbacks also work (`Diamond…` → gem, `Gold…`/`Platinum…` → metal).

### Why the seat is a triangle

glTF exporters often bake transforms into vertices, which would lose the seat's
orientation. `make_seat.py` therefore makes a tiny right triangle: origin = girdle centre,
a 1 mm leg along the table normal, and a 2 mm leg along the stone length. The loader
rebuilds the full transform from those three vertices (`seatFromTriangle`), so tilted or
rotated heads (east–west ovals, toi-et-moi) survive any exporter.

## 3. Scripts (Rhino 8, `ScriptEditor` or `_-RunPythonScript`)

| Script | Does |
|---|---|
| `rhino/make_seat.py` | Pick the girdle centre (and optionally the up and length directions). Creates `SEAT_center_<mm>` on a `Seats` layer. |
| `rhino/export_for_web.py` | Checks units and names. Re-meshes `GEM_*` polysurfaces with flat-facet settings (one planar region per facet, unwelded normals). Exports `public/models/<id>.glb` and adds/updates `manifest.json`. Refresh the browser and the setting appears under **Setting ◆**. |
| `rhino/import_gem.py` | Imports a **Stone .OBJ** exported from the configurator, orients it Z-up with the table on top, converts it to a clean faceted polysurface (`MergeAllCoplanarFaces`) and names it `GEM_…`. Use it to model a head around the exact stone a customer chose. |

### Manual export (if the script's export command needs adjusting)

`File → Export Selected… → .glb`, with:

- Map Rhino Z to glTF Y: **Yes**
- Export materials: optional (they are replaced anyway)
- Draco compression: Yes for production; the loader needs a DRACOLoader, see the roadmap
- Then add an entry to `public/models/manifest.json`:

```json
{
  "id": "cathedral-solitaire",
  "name": "Cathedral Solitaire",
  "file": "models/cathedral-solitaire.glb",
  "cuts": ["round", "oval"],
  "nominalStoneMm": 6.5,
  "includesBand": true
}
```

## 4. Meshing guidance

- **Gems:** must be closed, faceted and unwelded (flat normals). The export script does
  this. Never apply smooth normals to a gem; the ray tracer reads facet normals.
- **Metal:** use a fine render mesh (`DocumentProperties → Mesh → Smooth & slower`, or custom:
  max edge 0.3 mm, angle 5°). Keep each GLB under about 5 MB; decimate hidden areas such as
  the inside of the gallery.
- Use a **mesh check** (`_Check`, `_ShowEdges` → naked edges) on gems before export.

## 5. Sample

`public/models/sample-cathedral.glb` was produced by `tools/make-sample-setting.html`. It follows
the same contract and metre scaling as a Rhino export, so the whole path (load → unit fix →
metal swap → seat) is already exercised. Replace it with real work and delete its manifest entry.

## 6. When Claude is connected to Rhino

With a Rhino MCP / plug-in connection, Claude can run these same scripts inside Rhino:
place seats, validate names, export and register settings, and import the exact stones
shoppers design. Good first tasks:

1. Model 3–4 core heads (4-prong, 6-prong, cathedral, bezel, hidden halo) around `SEAT_center_6.50`.
2. Parametrise them in Grasshopper so one definition outputs every stone size (5.0–9.0 mm).
3. Batch-export one GLB per size and let the site pick the nearest head to the chosen carat.
