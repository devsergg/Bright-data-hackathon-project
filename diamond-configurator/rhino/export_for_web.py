#! python3
"""
Ring Studio — export the open Rhino model as a web-ready GLB.

Run in Rhino 8:  ScriptEditor → open this file → Run   (or: _-RunPythonScript "path/export_for_web.py")

What it does
  1. Checks the document is in millimetres.
  2. Validates the naming contract:
       METAL_*            metal parts (any number)
       GEM_*              fixed stones, must be closed
       SEAT_center[_mm]   exactly one centre-stone seat marker (see make_seat.py)
  3. Meshes GEM_ polysurfaces with "flat facet" settings (one planar region per
     facet, unwelded normals) so the ray tracer sees true facets.
  4. Exports everything to <web project>/public/models/<id>.glb
  5. Adds / updates the entry in public/models/manifest.json so the setting
     shows up in the configurator immediately (refresh the browser).

Modelling conventions (see docs/RHINO_PIPELINE.md)
  * Finger-hole centre at the world origin, finger axis along Rhino Y,
    head pointing up Rhino +Z.
  * glTF export must map Rhino Z → glTF Y (the exporter's default).
"""
import json
import os
import re

import Rhino
import rhinoscriptsyntax as rs
import scriptcontext as sc

STICKY_KEY = "ringstudio_web_project"


def fail(msg):
    rs.MessageBox(msg, 16, "Ring Studio export")
    raise SystemExit(msg)


def check_units():
    if sc.doc.ModelUnitSystem != Rhino.UnitSystem.Millimeters:
        if rs.MessageBox(
            "Document units are {0}, not millimetres.\n"
            "The web viewer works in mm. Continue anyway?".format(sc.doc.ModelUnitSystem),
            4 | 48,
            "Ring Studio export",
        ) != 6:
            raise SystemExit("cancelled")


def classify():
    metal, gems, seats, unnamed = [], [], [], []
    for oid in rs.AllObjects(select=False, include_lights=False, include_grips=False) or []:
        if not rs.IsObjectVisible(oid):
            continue
        name = (rs.ObjectName(oid) or "").strip()
        up = name.upper()
        if up.startswith("SEAT"):
            seats.append(oid)
        elif up.startswith("GEM"):
            gems.append(oid)
        elif up.startswith("METAL"):
            metal.append(oid)
        elif rs.IsBrep(oid) or rs.IsMesh(oid) or (hasattr(rs, "IsSubD") and rs.IsSubD(oid)):
            unnamed.append(oid)
    return metal, gems, seats, unnamed


def validate(metal, gems, seats, unnamed):
    problems = []
    if not metal:
        problems.append("No METAL_* objects found.")
    centre = [s for s in seats if (rs.ObjectName(s) or "").upper().startswith("SEAT_CENTER")]
    if len(centre) != 1:
        problems.append("Expected exactly one SEAT_center marker, found {0}. Run make_seat.py.".format(len(centre)))
    for g in gems:
        closed = rs.IsPolysurfaceClosed(g) if rs.IsPolysurface(g) else (rs.IsMeshClosed(g) if rs.IsMesh(g) else False)
        if not closed:
            problems.append("{0} is not closed — the ray tracer needs a watertight stone.".format(rs.ObjectName(g)))
    if unnamed:
        rs.SelectObjects(unnamed)
        problems.append(
            "{0} visible objects have no METAL_/GEM_/SEAT_ name (now selected). "
            "They will be exported as metal.".format(len(unnamed))
        )
    return problems


def flat_facet_mesh(brep_id):
    """Mesh a faceted gem so every planar face becomes its own flat region."""
    brep = rs.coercebrep(brep_id)
    mp = Rhino.Geometry.MeshingParameters.Minimal
    mp.SimplePlanes = True
    mp.JaggedSeams = True
    parts = Rhino.Geometry.Mesh.CreateFromBrep(brep, mp)
    mesh = Rhino.Geometry.Mesh()
    for p in parts:
        mesh.Append(p)
    mesh.Unweld(0.0, True)  # split every edge → flat per-facet normals
    mesh.Normals.ComputeNormals()
    mesh.Compact()
    return mesh


def main():
    check_units()
    metal, gems, seats, unnamed = classify()
    problems = validate(metal, gems, seats, unnamed)
    hard = [p for p in problems if "will be exported as metal" not in p]
    if problems:
        msg = "\n\n".join(problems)
        if hard:
            fail(msg)
        if rs.MessageBox(msg + "\n\nContinue?", 4 | 48, "Ring Studio export") != 6:
            raise SystemExit("cancelled")

    project = sc.sticky.get(STICKY_KEY)
    project = rs.BrowseForFolder(project, "Select the diamond-configurator folder (the one with package.json)")
    if not project:
        raise SystemExit("cancelled")
    if not os.path.exists(os.path.join(project, "package.json")):
        fail("That folder has no package.json — pick the diamond-configurator project folder.")
    sc.sticky[STICKY_KEY] = project

    default_name = os.path.splitext(sc.doc.Name or "setting")[0]
    name = rs.StringBox("Setting name shown to shoppers", default_name, "Ring Studio export")
    if not name:
        raise SystemExit("cancelled")
    sid = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

    models_dir = os.path.join(project, "public", "models")
    if not os.path.isdir(models_dir):
        os.makedirs(models_dir)
    glb_path = os.path.join(models_dir, sid + ".glb")

    # temporary flat-facet meshes for polysurface gems
    temp, hidden = [], []
    for g in gems:
        if rs.IsPolysurface(g) or rs.IsBrep(g):
            mid = sc.doc.Objects.AddMesh(flat_facet_mesh(g))
            rs.ObjectName(mid, rs.ObjectName(g))
            temp.append(mid)
            hidden.append(g)
    rs.HideObjects(hidden)

    try:
        export_ids = metal + [g for g in gems if g not in hidden] + temp + seats + unnamed
        rs.UnselectAllObjects()
        rs.SelectObjects(export_ids)
        # Rhino 8 glTF exporter; Enter accepts its options (keep "Map Z to Y" = Yes)
        ok = rs.Command('_-Export "{0}" _Enter _Enter'.format(glb_path), echo=False)
        if not ok or not os.path.exists(glb_path):
            fail("Export failed. Try File → Export Selected… → .glb manually to see the options dialog.")
    finally:
        rs.DeleteObjects(temp)
        rs.ShowObjects(hidden)
        rs.UnselectAllObjects()

    # nominal stone size from SEAT_center_<mm>
    nominal = None
    for s in seats:
        n = rs.ObjectName(s) or ""
        if n.upper().startswith("SEAT_CENTER"):
            m = re.search(r"_(\d+(?:\.\d+)?)$", n)
            if m:
                nominal = float(m.group(1))

    manifest_path = os.path.join(models_dir, "manifest.json")
    manifest = {"settings": []}
    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            manifest = json.load(f)
    entries = [e for e in manifest.get("settings", []) if e.get("id") != sid]
    entry = {
        "id": sid,
        "name": name,
        "file": "models/{0}.glb".format(sid),
        "includesBand": True,
        "notes": "Exported from {0}".format(sc.doc.Path or "Rhino"),
    }
    if nominal:
        entry["nominalStoneMm"] = nominal
    entries.append(entry)
    manifest["settings"] = entries
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print("Exported {0}\nUpdated {1}".format(glb_path, manifest_path))
    rs.MessageBox("Exported '{0}'.\nRefresh the configurator — it appears under Setting.".format(name), 64, "Ring Studio export")


if __name__ == "__main__":
    main()
