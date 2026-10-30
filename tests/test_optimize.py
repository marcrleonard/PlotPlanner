from lxml import etree

from plotplanner import optimize


def test_optimize_numbers_paths_and_keeps_layer_names(sample_svg):
    result = optimize.optimize(sample_svg, {"paper": "a4", "margin": 10})

    assert result["layers"] == [{"id": 1, "name": "rings"}, {"id": 2, "name": "wave"}]
    root = etree.fromstring(result["svg"].encode())
    ids = [el.get("id") for el in root.iter("{http://www.w3.org/2000/svg}path")]
    assert ids == [f"pp_{i}" for i in range(1, len(ids) + 1)]
    assert result["paths"] == len(ids) == 4
    # vpype's polylines/polygons are rewritten as paths so the driver keeps their ids
    assert not list(root.iter(*(f"{{http://www.w3.org/2000/svg}}{t}" for t in ("line", "polyline", "polygon"))))
    assert optimize.list_layers(result["svg"]) == result["layers"]


def test_layout_picks_orientation_from_drawing(sample_svg):
    landscape = optimize.optimize(sample_svg, {"paper": "a4"})["svg"]
    assert 'width="29.7cm"' in landscape
    portrait = optimize.optimize(sample_svg, {"paper": "a4", "orientation": "portrait"})["svg"]
    assert 'width="21.0cm"' in portrait


def test_sorting_does_not_add_travel():
    svg = open("svgs/tree_test_text.svg").read()
    result = optimize.optimize(svg, {"paper": "a3"})
    assert result["after"]["travel_mm"] <= result["before"]["travel_mm"]
    # straight strokes come out of vpype as <line>; every stroke must still get an id
    assert result["paths"] == result["after"]["paths"] == 41


def test_as_is_keeps_page(sample_svg):
    result = optimize.optimize(sample_svg, optimize.AS_IS)
    assert 'width="20.0000108cm"' in result["svg"] and optimize.is_prepared(result["svg"])


def test_rejects_empty_and_bad_options():
    import pytest

    empty = '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"></svg>'
    with pytest.raises(ValueError):
        optimize.optimize(empty)
    with pytest.raises(ValueError):
        optimize.OptimizeOptions.from_dict({"orientation": "sideways"})
    with pytest.raises(ValueError):
        optimize.optimize(open("svgs/tree_test_text.svg").read(), {"paper": "napkin"})


MIXED = """<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="200mm" height="100mm" viewBox="0 0 200 100">
  <title>mixed</title>
  <path d="M5 5 L20 5" stroke="blue" fill="none"/>
  <g id="plain"><path d="M10 10 L50 10" stroke="black" fill="none"/><path d="M10 20 L50 20" stroke="red" fill="none"/></g>
  <g inkscape:groupmode="layer" inkscape:label="named"><path d="M10 30 L50 30" stroke="red" fill="none"/></g>
  <circle cx="150" cy="50" r="10" stroke="blue" fill="none"/>
</svg>"""


def test_every_top_level_group_and_loose_drawing_gets_its_own_layer():
    # vpype alone folds the plain group and the loose elements into layer 1
    result = optimize.optimize(MIXED, optimize.AS_IS)
    assert result["layers"] == [
        {"id": 1, "name": "ungrouped"},
        {"id": 2, "name": "plain"},
        {"id": 3, "name": "named"},
    ]
    assert result["paths"] == 5


def test_layers_from_stroke_colour():
    result = optimize.optimize(MIXED, {"paper": None, "layers_from": "color"})
    assert [layer["name"] for layer in result["layers"]] == ["#0000ff", "#000000", "#ff0000"]
    assert result["after"]["paths"] == 5


def test_ungrouped_svg_stays_one_layer():
    flat = '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"><path d="M1 1 L9 9" stroke="#000"/></svg>'
    assert len(optimize.optimize(flat, optimize.AS_IS)["layers"]) == 1


def test_pen_change_layers_go_between_layers(sample_svg):
    svg = optimize.add_pen_changes(optimize.optimize(sample_svg, optimize.AS_IS)["svg"])
    root = etree.fromstring(svg.encode())
    labels = [g.get(f"{{{optimize.INKSCAPE_NS}}}label") for g in root.iterfind("svg:g", optimize.NSMAP)]
    assert labels == ["1 rings", "!2 wave", "2 wave"]
    assert optimize.add_pen_changes(svg) == svg  # idempotent
    assert optimize.list_layers(svg) == [{"id": 1, "name": "rings"}, {"id": 2, "name": "wave"}]


def test_layout_reports_page_and_drawing_size(sample_svg):
    result = optimize.optimize(sample_svg, {"paper": "a4", "margin": 10})
    assert result["page_mm"] == [297.0, 210.0]
    x, y, w, h = result["bounds_mm"]
    assert x >= 9.9 and y >= 9.9 and x + w <= 287.1 and y + h <= 200.1  # inside the margins
    assert abs(w - 277) < 0.5 or abs(h - 190) < 0.5  # scaled to touch them

    custom = optimize.optimize(sample_svg, {"paper": "120x80mm", "fit": False})
    assert custom["page_mm"] == [120.0, 80.0] and custom["bounds_mm"][2] > 120  # runs off the sheet
