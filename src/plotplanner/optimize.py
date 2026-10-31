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
LAYER_SOURCES = ["groups", "color"]  # what becomes a layer (a pen): top-level groups, or stroke colours
UNGROUPED = "ungrouped"
PEN_CHANGE_PREFIX = "!"  # the driver pauses at a layer whose name starts with "!"
# Top-level elements that are not drawing.
NON_DRAWING = {"defs", "metadata", "title", "desc", "style", "script", "namedview"}

PX_PER_MM = 96 / 25.4


@dataclass
class OptimizeOptions:
    """What the Prepare step can change. Lengths are in millimetres."""

    paper: str | None = "a3"  # one of PAPER_SIZES, "WxH" in mm, or None to keep the source page
    orientation: str = "auto"  # auto: follow the drawing; source: follow the input page
    margin: float = 15.0
    fit: bool = True  # scale to fill the margins; otherwise only centre
    merge: bool = True
    merge_tolerance: float = 0.35  # join line ends closer than this; about a pen's line width
    sort: bool = True
    two_opt: bool = False  # slower, better sort
    reloop: bool = False  # randomises loop start points; usually adds travel
    simplify: bool = True
    simplify_tolerance: float = 0.05
    min_length: float = 0.0  # drop lines shorter than this; 0 keeps everything
    layers_from: str = "groups"  # one of LAYER_SOURCES

    @classmethod
    def from_dict(cls, data: dict | None) -> "OptimizeOptions":
        data = data or {}
        known = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        opts = cls(**known)
        if opts.paper in ("", "none", "source"):
            opts.paper = None
        if opts.orientation not in ORIENTATIONS:
            raise ValueError(f"orientation must be one of {ORIENTATIONS}")
        if opts.layers_from not in LAYER_SOURCES:
            raise ValueError(f"layers_from must be one of {LAYER_SOURCES}")
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
    if opts.min_length > 0:
        steps.append(f"filter --min-length {opts.min_length}mm")
    # reloop randomises where closed paths start, so it has to run before sorting.
    if opts.reloop:
        steps.append("reloop")
    if opts.sort:
        steps.append("linesort --two-opt" if opts.two_opt else "linesort")
    if opts.simplify:
        steps.append(f"linesimplify --tolerance {opts.simplify_tolerance}mm")
    return " ".join(steps)


def _group_layers(svg: str) -> tuple[str, dict[int, str]]:
    """Make every top-level group a numbered layer, and collect drawing outside any group into
    its own "ungrouped" layer, so vpype keeps them apart (it folds both into layer 1 otherwise).

    Returns the rewritten SVG and {layer number: original name}. An SVG with no top-level
    groups is returned unchanged, as a single layer.
    """
    root = etree.fromstring(svg.encode("utf-8"), parser=etree.XMLParser(huge_tree=True))
    children = [el for el in root if isinstance(el.tag, str) and etree.QName(el).localname not in NON_DRAWING]
    if not any(etree.QName(el).localname == "g" for el in children):
        return svg, {}

    loose = [el for el in children if etree.QName(el).localname != "g"]
    if loose:
        # The ungrouped layer sits where the first loose element was.
        holder = etree.Element(f"{{{SVG_NS}}}g", {f"{{{INKSCAPE_NS}}}label": UNGROUPED})
        loose[0].addprevious(holder)
        for el in loose:
            holder.append(el)

    names = {}
    for number, g in enumerate(root.iterfind("svg:g", NSMAP), start=1):
        names[number] = g.get(f"{{{INKSCAPE_NS}}}label") or g.get("id") or ""
        g.set(f"{{{INKSCAPE_NS}}}groupmode", "layer")
        g.set(f"{{{INKSCAPE_NS}}}label", str(number))
    return etree.tostring(root, encoding="unicode"), names


def _read(svg: str, opts: OptimizeOptions) -> tuple[vp.Document, dict[int, str]]:
    # 0.1 mm quantization: curves become polylines well below pen width.
    quantization = 0.1 * PX_PER_MM
    if opts.layers_from == "color":
        doc = vp.read_svg_by_attributes(io.StringIO(svg), ["stroke"], quantization)
        names = {lid: str(layer.property(vp.METADATA_FIELD_COLOR) or "") for lid, layer in doc.layers.items()}
    else:
        svg, names = _group_layers(svg)
        doc = vp.read_multilayer_svg(io.StringIO(svg), quantization)
    return doc, names


def add_pen_changes(svg: str) -> str:
    """Insert an empty "!<next layer>" layer before every layer but the first. The driver pauses
    there (its layer-name pause), which is where the pen gets swapped.

    A document that already has "!" layers (added here before, or by its author) is left as is.
    """
    root = etree.fromstring(svg.encode("utf-8"), parser=etree.XMLParser(huge_tree=True))
    layers = list(root.iterfind("svg:g[@inkscape:groupmode='layer']", NSMAP))
    if any(g.get(f"{{{INKSCAPE_NS}}}label", "").startswith(PEN_CHANGE_PREFIX) for g in layers):
        return svg
    for g in layers[1:]:
        label = g.get(f"{{{INKSCAPE_NS}}}label", "")
        g.addprevious(etree.Element(f"{{{SVG_NS}}}g", {
            f"{{{INKSCAPE_NS}}}groupmode": "layer",
            f"{{{INKSCAPE_NS}}}label": f"{PEN_CHANGE_PREFIX}{label}",
        }))
    return etree.tostring(root, encoding="unicode")


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

    doc, source_names = _read(svg, opts)
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

    names = {lid: source_names.get(lid) or layer.property(vp.METADATA_FIELD_NAME) for lid, layer in doc.layers.items()}
    out = io.StringIO()
    vp.write_svg(out, doc, layer_label_format="%d", set_date=False)
    svg_out, count = label_and_number(out.getvalue(), names)

    page = doc.page_size
    bounds = doc.bounds()
    return {
        "svg": svg_out,
        "paths": count,
        "page_mm": [round(float(v) / PX_PER_MM, 1) for v in page] if page else None,
        # x, y, width, height of the drawing on the page
        "bounds_mm": [round(float(v) / PX_PER_MM, 1) for v in (bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1])]
        if bounds else None,
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
