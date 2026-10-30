# Vendored driver

These packages come from iDraw's Inkscape extension bundle
(`bin/idraw_inkscape/inkscape1.0_extensions_V270_r3.zip`, `extensions/axidraw_deps/`):

| package | version | upstream |
|---|---|---|
| `axidrawinternal` | 2.7.0 | Evil Mad Scientist AxiDraw driver (GPL v2), iDraw build |
| `plotink` | 1.2.0 | https://github.com/evil-mad/plotink (MIT) |
| `ink_extensions`, `ink_extensions_utils` | 1.1.0 | Evil Mad Scientist's packaging of Inkscape's `inkex` helpers (GPL v2) |

They are vendored rather than installed because the iDraw build differs from stock AxiDraw only in
`axidrawinternal/axidraw_conf.py`, and the newer `plotink` / `ink_extensions` on PyPI have
incompatible APIs.

## iDraw vs stock AxiDraw 2.7.0 (`axidraw_conf.py`)

| setting | iDraw | AxiDraw |
|---|---|---|
| `native_res_factor` (steps per inch) | 1270 | 1016 |
| `servo_max` | 28000 | 25200 |
| `servo_min` | 7500 | 10800 |

## PlotPlanner patches

Each is marked with a `PlotPlanner patch` comment.

- `plotink/ebb_serial.py`, `axidrawinternal/axidraw_options/versions.py`: `distutils` (removed in
  Python 3.12) replaced with a numeric `LooseVersion` stand-in.
- `ink_extensions/simpletransform.py`: raw-string regex (invalid escape warning).
- `axidrawinternal/axidraw.py` `PauseResumeCheck`: a forced pause set `str_button = 1`, then
  indexed it as a string, so every software pause was reported as "USB connection lost".
- Removed the Inkscape-only entry points (`axidraw_control.py`, `axidraw_naming.py`,
  `eggbot_hatch.py`).
