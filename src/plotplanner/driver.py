"""The plotter driver: iDraw's build of the AxiDraw 2.7.0 driver, with hooks for PlotPlanner.

The vendored copy under _vendor/ is what iDraw ships for Inkscape. Its axidraw_conf.py carries
the iDraw-specific values (native_res_factor 1270 rather than 1016, servo range 7500-28000
rather than 10800-25200); everything else is stock AxiDraw.
"""

from __future__ import annotations

import os
import sys
from typing import Callable

_VENDOR = os.path.join(os.path.dirname(__file__), "_vendor")
if _VENDOR not in sys.path:
    sys.path.insert(0, _VENDOR)

from axidrawinternal import axidraw  # noqa: E402
from plotink import ebb_serial  # noqa: E402

# Plot settings the API accepts, with their types. Names match the AxiDraw options.
SETTINGS = {
    "speed_pendown": int,  # 1-110, % of max speed while drawing
    "speed_penup": int,  # 1-110, % of max speed while travelling
    "accel": int,  # 1-100
    "pen_pos_down": int,  # 0-100, servo position
    "pen_pos_up": int,  # 0-100
    "pen_rate_lower": int,  # 1-100
    "pen_rate_raise": int,  # 1-100
    "pen_delay_down": int,  # ms
    "pen_delay_up": int,  # ms
    "const_speed": bool,
    "auto_rotate": bool,  # plot portrait documents rotated, to use the long axis
    "resolution": int,  # 1 high (16x microstepping), 2 low/faster
    "model": int,  # 1: 300x218 mm, 2: A3 (430x297 mm), 3: XLX, 4: MiniKit
    "port": str,  # serial port; empty for the first plotter found
}

DEFAULT_SETTINGS = {
    "speed_pendown": 25,
    "speed_penup": 75,
    "accel": 75,
    "pen_pos_down": 45,
    "pen_pos_up": 20,
    "pen_rate_lower": 50,
    "pen_rate_raise": 75,
    "pen_delay_down": 0,
    "pen_delay_up": 0,
    "const_speed": False,
    "auto_rotate": True,
    "resolution": 1,
    # The old PlotPlanner driver allowed 17 x 12 in of travel, so this machine is A3-sized.
    "model": 2,
    "port": "",
}

MANUAL_COMMANDS = ["raise_pen", "lower_pen", "enable_xy", "disable_xy", "fw_version"]


def clean_settings(settings: dict | None) -> dict:
    """Keep known settings and coerce their types."""
    out = {}
    for key, value in (settings or {}).items():
        kind = SETTINGS.get(key)
        if kind is None or value is None:
            continue
        if kind is bool and isinstance(value, str):
            value = value.lower() in ("1", "true", "yes", "on")
        out[key] = kind(value)
    return out


def list_ports() -> list[str]:
    """Serial ports that look like an EiBotBoard. Does not open them."""
    return [str(p[0]) for p in (ebb_serial.listEBBports() or [])]


class Driver(axidraw.AxiDraw):
    """AxiDraw with progress callbacks and a pause request that works from another thread."""

    def __init__(
        self,
        on_path_start: Callable[[str | None], None] = lambda path_id: None,
        on_path_done: Callable[[str | None], None] = lambda path_id: None,
        pause_requested: Callable[[], bool] = lambda: False,
        message: Callable[[str], None] = print,
    ):
        super().__init__(default_logging=False, user_message_fun=self._relay)
        self.params.check_updates = False
        self._message = message
        self._on_path_start = on_path_start
        self._on_path_done = on_path_done
        self._pause_requested = pause_requested
        self._remote_pause = False

    def _relay(self, text):
        # A remote pause goes through the driver's forced-pause path, which credits a layer name.
        if self._remote_pause and str(text).startswith("Plot paused by layer name control"):
            text = "Plot paused."
        self._message(text)

    def configure(self, svg: str, settings: dict, mode: str = "plot", layer: int | None = None, preview: bool = False):
        self.plot_setup(svg)
        for key, value in clean_settings(settings).items():
            if key == "port":
                value = value or None
            setattr(self.options, key, value)
        self.options.mode = mode
        if layer is not None and mode == "plot":
            self.options.mode = "layers"
            self.options.layer = int(layer)
        self.options.preview = preview

    def plot_path(self, path, mat_transform):
        path_id = path.get("id")
        if self.plot_current_layer and not self.resume_mode:
            self._on_path_start(path_id)
        super().plot_path(path, mat_transform)
        if self.plot_current_layer and not self.b_stopped:
            self._on_path_done(path_id)

    def PauseResumeCheck(self):  # noqa: N802 - overrides the driver's name
        if not self.b_stopped and self._pause_requested():
            self.force_pause = True
            self._remote_pause = True
        super().PauseResumeCheck()
