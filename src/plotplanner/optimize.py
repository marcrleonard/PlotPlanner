"""SVG preparation: vpype pipeline, layer labels and stable path ids."""

from __future__ import annotations

import io
from dataclasses import dataclass

import vpype as vp
import vpype_cli
from lxml import etree

SVG_NS = "http://www.w3.org/2000/svg"
INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape"
NSMAP = {"svg": SVG_NS, "inkscape": INKSCAPE_NS}

PATH_ID_PREFIX = "pp_"
PAPER_SIZES = ["a6", "a5", "a4", "a3", "a2", "letter", "legal", "tabloid"]
ORIENTATIONS = ["auto", "source", "portrait", "landscape"]

PX_PER_MM = 96 / 25.4


@dataclass
class OptimizeOptions:
    """What the Prepare step can change. Lengths are in millimetres."""

    paper: str | None = "a3"  # one of PAPER_SIZES, "WxH" in mm, or None to keep the source page
    orientation: str = "auto"  # auto: follow the drawing; source: follow the input page
    margin: float = 15.0
    fit: bool = True  # scale to fill the margins; otherwise only centre
    merge: bool = True
    merge_tolerance: float = 0.1
    sort: bool = True
    two_opt: bool = False  # slower, better sort
    reloop: bool = False  # randomises loop start points; usually adds travel
    simplify: bool = True
    simplify_tolerance: float = 0.05

    @classmethod
    def from_dict(cls, data: dict | None) -> "OptimizeOptions":
        data = data or {}
        known = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        opts = cls(**known)
        if opts.paper in ("", "none", "source"):
            opts.paper = None
        if opts.orientation not in ORIENTATIONS:
            raise ValueError(f"orientation must be one of {ORIENTATIONS}")
        return opts


def _stats(doc: vp.Document) -> dict:
    return {
        "layers": len(doc.layers),
        "paths": sum(len(layer) for layer in doc.layers.values()),
        "draw_mm": round(doc.length() / PX_PER_MM),
        "travel_mm": round(doc.pen_up_length() / PX_PER_MM),
    }


def _paper_size(paper: str) -> tuple[float, float]:
    """Paper size in px, portrait."""
    paper = paper.strip().lower()
    if paper in vp.PAGE_SIZES:
        w, h = vp.PAGE_SIZES[paper]
    else:
        try:
            w, h = (float(v) * PX_PER_MM for v in paper.removesuffix("mm").split("x"))
        except ValueError:
            raise ValueError(f"unknown paper size {paper!r}; use {PAPER_SIZES} or WxH in mm") from None
    return min(w, h), max(w, h)


def _layout(opts: OptimizeOptions, doc: vp.Document) -> str:
    if not opts.paper:
        return ""
    w, h = _paper_size(opts.paper)
    if opts.orientation == "landscape":
        landscape = True
    elif opts.orientation == "portrait":
        landscape = False
    elif opts.orientation == "source" and doc.page_size:
        landscape = doc.page_size[0] > doc.page_size[1]
    else:
        bounds = doc.bounds()
        landscape = bool(bounds) and (bounds[2] - bounds[0]) > (bounds[3] - bounds[1])
    # vpype treats every size as portrait and rotates the page with --landscape.
    args = f"{w / PX_PER_MM:.3f}x{h / PX_PER_MM:.3f}mm"
    if landscape:
        args = f"--landscape {args}"
    if opts.fit:
        args = f"--fit-to-margins {opts.margin}mm {args}"
    return f"layout {args}"


def _pipeline(opts: OptimizeOptions) -> str:
    steps = []
    if opts.merge:
        steps.append(f"linemerge --tolerance {opts.merge_tolerance}mm")
    # reloop randomises where closed paths start, so it has to run before sorting.
    if opts.reloop:
        steps.append("reloop")
    if opts.sort:
        steps.append("linesort --two-opt" if opts.two_opt else "linesort")
    if opts.simplify:
        steps.append(f"linesimplify --tolerance {opts.simplify_tolerance}mm")
    return " ".join(steps)


def label_and_number(svg: str, layer_names: dict[int, str] | None = None) -> tuple[str, int]:
    """Give every path a sequential id (pp_1, pp_2, ...) in document order, which is also plot
    order, and name layers "<n> <name>" so the plotter's layer mode can select them.

    vpype writes lines, polylines and polygons; the driver turns those into new, id-less path elements
    while plotting, so they are rewritten as <path> here to keep progress reporting by id.

    Returns the new SVG and the number of paths.
    """
    root = etree.fromstring(svg.encode("utf-8"), parser=etree.XMLParser(huge_tree=True))
    count = 0
    for el in root.iter(f"{{{SVG_NS}}}path", f"{{{SVG_NS}}}polyline", f"{{{SVG_NS}}}polygon", f"{{{SVG_NS}}}line"):
        tag = etree.QName(el).localname
        if tag == "line":
            x1, y1, x2, y2 = (el.attrib.pop(k, "0") for k in ("x1", "y1", "x2", "y2"))
            el.tag = f"{{{SVG_NS}}}path"
            el.set("d", f"M{x1},{y1} L{x2},{y2}")
        elif tag != "path":
            points = el.attrib.pop("points", "").replace(",", " ").split()
            pairs = [f"{points[i]},{points[i + 1]}" for i in range(0, len(points) - 1, 2)]
            el.tag = f"{{{SVG_NS}}}path"
            el.set("d", "M" + " L".join(pairs) + (" Z" if tag == "polygon" else ""))
        count += 1
        el.set("id", f"{PATH_ID_PREFIX}{count}")
    if layer_names:
        for g in root.iterfind("svg:g[@inkscape:groupmode='layer']", NSMAP):
            label = g.get(f"{{{INKSCAPE_NS}}}label", "")
            if label.isdigit() and layer_names.get(int(label)):
                g.set(f"{{{INKSCAPE_NS}}}label", f"{label} {layer_names[int(label)]}")
    return etree.tostring(root, encoding="unicode"), count


def optimize(svg: str, options: OptimizeOptions | dict | None = None) -> dict:
    """Run the vpype pipeline over an SVG string.

    Returns {"svg", "paths", "layers", "before", "after"}.
    """
    opts = options if isinstance(options, OptimizeOptions) else OptimizeOptions.from_dict(options)

    # 0.1 mm quantization: curves become polylines well below pen width.
    doc = vp.read_multilayer_svg(io.StringIO(svg), quantization=0.1 * PX_PER_MM)
    if doc.is_empty():
        raise ValueError("no drawable paths found in SVG")

    # Lay out first so the stats compare like with like and tolerances are in final millimetres.
    layout = _layout(opts, doc)
    if layout:
        doc = vpype_cli.execute(layout, document=doc)
    before = _stats(doc)
    pipeline = _pipeline(opts)
    if pipeline:
        doc = vpype_cli.execute(pipeline, document=doc)
    after = _stats(doc)

    names = {lid: layer.property(vp.METADATA_FIELD_NAME) for lid, layer in doc.layers.items()}
    out = io.StringIO()
    vp.write_svg(out, doc, layer_label_format="%d", set_date=False)
    svg_out, count = label_and_number(out.getvalue(), names)

    return {
        "svg": svg_out,
        "paths": count,
        "layers": [{"id": lid, "name": names[lid] or ""} for lid in sorted(doc.layers)],
        "before": before,
        "after": after,
    }


AS_IS = OptimizeOptions(paper=None, merge=False, sort=False, reloop=False, simplify=False)


def is_prepared(svg: str) -> bool:
    return f'id="{PATH_ID_PREFIX}1"' in svg


def list_layers(svg: str) -> list[dict]:
    root = etree.fromstring(svg.encode("utf-8"), parser=etree.XMLParser(huge_tree=True))
    layers = []
    for g in root.iterfind("svg:g[@inkscape:groupmode='layer']", NSMAP):
        label = g.get(f"{{{INKSCAPE_NS}}}label", "")
        number, _, name = label.partition(" ")
        if number.isdigit():
            layers.append({"id": int(number), "name": name})
    return layers
