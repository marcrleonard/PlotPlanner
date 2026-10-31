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


BROKEN = """<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="20mm" viewBox="0 0 100 20">
  <path d="M10 10 L30 10" stroke="#000"/><path d="M30.2 10 L50 10" stroke="#000"/>
  <path d="M50.3 10 L70 10" stroke="#000"/><path d="M80 10 L80.1 10" stroke="#000"/>
</svg>"""


def test_merge_gap_joins_ends_closer_than_a_pen_width():
    # gaps of 0.2 and 0.3 mm: joined by the 0.35 mm default, not by 0.1 mm
    assert optimize.optimize(BROKEN, {"paper": None, "merge_tolerance": 0.1})["after"]["paths"] == 4
    assert optimize.optimize(BROKEN, {"paper": None})["after"]["paths"] == 2


def test_min_length_drops_specks():
    assert optimize.optimize(BROKEN, {"paper": None, "min_length": 0.5})["after"]["paths"] == 1


def test_position_anchors_the_drawing_margin_in_from_the_edges(sample_svg):
    def bounds(**opts):
        return optimize.optimize(sample_svg, {"paper": "a4", "orientation": "landscape", "margin": 10, **opts})["bounds_mm"]

    x, y, w, h = bounds(fit=False, position="top-left")
    assert (round(x, 1), round(y, 1)) == (10.0, 10.0)
    x, y, w, h = bounds(fit=False, position="bottom-right")
    assert (round(x + w, 1), round(y + h, 1)) == (287.0, 200.0)
    x, y, w, h = bounds(fit=False, position="center")
    assert abs((x + w / 2) - 148.5) < 0.1 and abs((y + h / 2) - 105) < 0.1
    x, y, w, h = bounds(fit=True, position="top-left")  # scaled to the margins, then anchored
    assert (round(x, 1), round(y, 1)) == (10.0, 10.0) and (round(w) == 277 or round(h) == 190)


def test_keep_leaves_the_drawing_where_it_was(sample_svg):
    source = optimize.optimize(sample_svg, optimize.AS_IS)["bounds_mm"]
    on_a3 = optimize.optimize(sample_svg, {"paper": "a3", "fit": False, "position": "keep"})["bounds_mm"]
    assert [round(v, 1) for v in on_a3] == [round(v, 1) for v in source]


def test_bad_position():
    import pytest

    with pytest.raises(ValueError):
        optimize.OptimizeOptions.from_dict({"position": "middle-earth"})


def test_width_scales_the_drawing_keeping_proportions(sample_svg):
    natural = optimize.optimize(sample_svg, optimize.AS_IS)["bounds_mm"]
    sized = optimize.optimize(sample_svg, {"paper": "430x297mm", "orientation": "landscape", "fit": False,
                                           "position": "top-left", "margin": 10, "width": 100})["bounds_mm"]
    assert [round(v, 1) for v in sized[:3]] == [10.0, 10.0, 100.0]
    assert abs(sized[3] - natural[3] * 100 / natural[2]) < 0.1


CARD = "tests/data/card_6x4in.svg"  # a 6 x 4 in page whose lines sit inside ~0.3 in of padding


def test_reference_page_places_the_whole_card():
    svg = open(CARD).read()
    quick = {**optimize.AS_IS.__dict__, "paper": "430x297mm", "orientation": "landscape", "position": "top-left",
             "margin": 10}
    by_lines = optimize.optimize(svg, {**quick, "reference": "lines"})["bounds_mm"]
    by_page = optimize.optimize(svg, {**quick, "reference": "page"})["bounds_mm"]
    # by lines: the lines start 10 mm in; by page: the card's corner is 10 mm in, its padding kept
    assert [round(v, 1) for v in by_lines[:2]] == [10.0, 10.0]
    assert abs(by_page[0] - (10 + 0.385 * 25.4)) < 0.3 and abs(by_page[1] - (10 + 0.269 * 25.4)) < 0.3
    assert abs(by_page[2] - by_lines[2]) < 0.1  # same size either way: as drawn


def test_reference_page_width_scales_the_card():
    svg = open(CARD).read()
    result = optimize.optimize(svg, {**optimize.AS_IS.__dict__, "paper": "430x297mm", "orientation": "landscape",
                                     "position": "top-left", "margin": 0, "width": 76.2, "reference": "page"})
    # card 6 in -> 3 in wide: the lines halve too, and keep their padding (halved)
    x, y, w, h = result["bounds_mm"]
    assert abs(w - 5.231 * 25.4 / 2) < 0.2 and abs(x - 0.385 * 25.4 / 2) < 0.2
