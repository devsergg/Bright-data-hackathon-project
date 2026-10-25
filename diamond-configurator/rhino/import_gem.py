#! python3
"""
Ring Studio — import a stone exported from the configurator (Stone .OBJ).

The web app exports the exact facet geometry in millimetres, Y-up. This script
imports it, makes it Z-up with the table on top, converts it to a clean faceted
polysurface (one face per facet) and names it, so you can model a setting
around the precise stone the shopper chose.
"""
import os

import rhinoscriptsyntax as rs
import scriptcontext as sc

path = rs.OpenFileName("Stone OBJ from Ring Studio", "OBJ (*.obj)|*.obj||")
if not path:
    raise SystemExit("cancelled")

before = set(rs.AllObjects() or [])
rs.Command('_-Import "{0}" _Enter'.format(path), echo=False)
new = [o for o in (rs.AllObjects() or []) if o not in before]
meshes = [o for o in new if rs.IsMesh(o)]
if not meshes:
    raise SystemExit("Nothing imported")
mesh = meshes[0] if len(meshes) == 1 else rs.JoinMeshes(meshes, True)

# Depth is a stone's smallest dimension → make that axis Rhino Z.
bb = rs.BoundingBox(mesh)
ext = [bb[6][i] - bb[0][i] for i in range(3)]
axis = ext.index(min(ext))
if axis == 1:  # Y-up OBJ imported as-is
    rs.RotateObject(mesh, (0, 0, 0), 90, (1, 0, 0))
elif axis == 0:
    rs.RotateObject(mesh, (0, 0, 0), -90, (0, 1, 0))

# Table up: the table has many vertices at max Z, the culet/keel only 1–2 at min Z.
verts = rs.MeshVertices(mesh)
zs = [v.Z for v in verts]
zmax, zmin = max(zs), min(zs)
eps = (zmax - zmin) * 0.01
top = sum(1 for z in zs if z > zmax - eps)
bot = sum(1 for z in zs if z < zmin + eps)
if bot > top:
    rs.RotateObject(mesh, (0, 0, 0), 180, (1, 0, 0))

# Girdle plane to Z = 0 is already true for configurator exports.
rs.UnselectAllObjects()
rs.SelectObject(mesh)
rs.Command("_MeshToNURB _DeleteInput=_Yes", echo=False)
brep = rs.LastCreatedObjects()
if brep:
    rs.SelectObjects(brep)
    rs.Command("_MergeAllCoplanarFaces", echo=False)
    target = brep[0]
else:
    target = mesh

stem = os.path.splitext(os.path.basename(path))[0]
rs.ObjectName(target, "GEM_" + stem)
if not rs.IsLayer("Gems"):
    rs.AddLayer("Gems", (120, 200, 255))
rs.ObjectLayer(target, "Gems")
rs.UnselectAllObjects()
sc.doc.Views.Redraw()
print("Imported {0} as GEM_{1}".format(path, stem))
