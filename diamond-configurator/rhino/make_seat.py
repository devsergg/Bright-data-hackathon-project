#! python3
"""
Ring Studio — place a stone SEAT marker.

The marker is a tiny right triangle that survives any glTF exporter, because
the configurator reads its *vertices*, not its transform:

    origin  = girdle centre of the stone
    + 1 mm  along the stone's UP     (table normal)
    + 2 mm  along the stone's LENGTH (north–south; matters for ovals, pears…)

Run in Rhino 8, pick the girdle centre, then optionally the up and length
directions (Enter = Rhino +Z up, +Y length). Enter the stone width the head
was designed for — it becomes part of the name, e.g. SEAT_center_6.50.
"""
import Rhino
import rhinoscriptsyntax as rs
import scriptcontext as sc

origin = rs.GetPoint("Girdle centre of the stone")
if origin is None:
    raise SystemExit("cancelled")

up_pt = rs.GetPoint("Point along the table normal (Enter = world +Z)", origin)
up = (up_pt - origin) if up_pt else Rhino.Geometry.Vector3d(0, 0, 1)
up.Unitize()

len_pt = rs.GetPoint("Point along the stone length (Enter = world +Y)", origin)
length = (len_pt - origin) if len_pt else Rhino.Geometry.Vector3d(0, 1, 0)
# make length exactly perpendicular to up
length = length - up * (length * up)
if length.IsTiny():
    length = Rhino.Geometry.Vector3d.CrossProduct(up, Rhino.Geometry.Vector3d(1, 0, 0))
length.Unitize()

role = rs.GetString("Seat role", "center", ["center", "side", "accent"]) or "center"
width = rs.GetReal("Nominal stone width in mm (0 = skip)", 0, 0)

mesh = Rhino.Geometry.Mesh()
mesh.Vertices.Add(origin)
mesh.Vertices.Add(origin + up * 1.0)
mesh.Vertices.Add(origin + length * 2.0)
mesh.Faces.AddFace(0, 1, 2)
mesh.Normals.ComputeNormals()

oid = sc.doc.Objects.AddMesh(mesh)
name = "SEAT_{0}".format(role) + ("_{0:.2f}".format(width) if width else "")
rs.ObjectName(oid, name)
layer = "Seats"
if not rs.IsLayer(layer):
    rs.AddLayer(layer, (255, 0, 160))
rs.ObjectLayer(oid, layer)
sc.doc.Views.Redraw()
print("Placed {0}".format(name))
