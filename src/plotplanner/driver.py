"""The plotter driver: iDraw's build of the AxiDraw 2.7.0 driver, with hooks for PlotPlanner.

The vendored copy under _vendor/ is what iDraw ships for Inkscape. Its axidraw_conf.py carries
the iDraw-specific values (native_res_factor 1270 rather than 1016, servo range 7500-28000
rather than 10800-25200); everything else is stock AxiDraw.
"""

from __future__ import annotations

import os
import sys
import types
from typing import Callable

_VENDOR = os.path.join(os.path.dirname(__file__), "_vendor")
if _VENDOR not in sys.path:
    sys.path.insert(0, _VENDOR)

from axidrawinternal import axidraw  # noqa: E402
from plotink import ebb_motion, ebb_serial  # noqa: E402

# Plot settings the API accepts: type and allowed range. Names match the AxiDraw options.
SETTINGS = {
    "speed_pendown": (int, 1, 110),  # % of max speed while drawing
    "speed_penup": (int, 1, 110),  # % of max speed while travelling
    "accel": (int, 1, 100),
    "pen_pos_down": (int, 0, 100),  # servo position
    "pen_pos_up": (int, 0, 100),
    "pen_rate_lower": (int, 1, 100),
    "pen_rate_raise": (int, 1, 100),
    "pen_delay_down": (int, 0, 10_000),  # ms
    "pen_delay_up": (int, 0, 10_000),  # ms
    "const_speed": (bool, None, None),
    "auto_rotate": (bool, None, None),  # plot portrait documents rotated, to use the long axis
    "resolution": (int, 1, 2),  # 1 high (16x microstepping), 2 low/faster
    "model": (int, 1, 4),  # 1: 300x218 mm, 2: A3 (430x297 mm), 3: XLX, 4: MiniKit
    "port": (str, None, None),  # serial port; empty for the first plotter found
    # Calibration overrides; 0 keeps the driver's value for the machine model.
    "reach_x": (float, 0, 2000),  # mm the carriage can travel in X
    "reach_y": (float, 0, 2000),  # mm in Y
    "steps_per_inch": (float, 0, 10000),  # the driver's native_res_factor (iDraw 1270, AxiDraw 1016)
}

# Settings that can change while a plot runs; the rest change the geometry or the connection.
LIVE_SETTINGS = frozenset(SETTINGS) - {"auto_rotate", "resolution", "model", "port", "reach_x", "reach_y", "steps_per_inch"}
TRAVEL_PARAMS = ("default", "V3A3", "V3XLX", "MiniKit")  # the driver's x_travel_* / y_travel_* names

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
    # iDraw A3 machines are listed at 420 x 297 mm of travel; the driver's A3 model assumes the AxiDraw
    # A3's 430. Start 10 mm short rather than drive into the end stop; measure with Drive & calibrate.
    "reach_x": 420.0,
    "reach_y": 0.0,
    "steps_per_inch": 0.0,
}

def machine_travel_mm() -> dict[int, list[float]]:
    """Reachable area (x, y) per machine model, from the driver's config."""
    p = axidraw.AxiDraw(default_logging=False).params
    travel = {
        1: (p.x_travel_default, p.y_travel_default),
        2: (p.x_travel_V3A3, p.y_travel_V3A3),
        3: (p.x_travel_V3XLX, p.y_travel_V3XLX),
        4: (p.x_travel_MiniKit, p.y_travel_MiniKit),
    }
    return {model: [round(x * 25.4), round(y * 25.4)] for model, (x, y) in travel.items()}


def default_steps_per_inch() -> float:
    return float(axidraw.AxiDraw(default_logging=False).params.native_res_factor)


def pen_heights_reversed() -> bool:
    """True when a lower pen position number means a higher pen, as on the iDraw (its own defaults
    are up 20, down 45; stock AxiDraw's are up 60, down 30)."""
    p = axidraw.AxiDraw(default_logging=False).params
    return p.pen_pos_up < p.pen_pos_down


MANUAL_COMMANDS = ["raise_pen", "lower_pen", "enable_xy", "disable_xy", "fw_version"]


def clean_settings(settings: dict | None) -> dict:
    """Keep known settings, coerce their types and clamp them to range."""
    out = {}
    for key, value in (settings or {}).items():
        if key not in SETTINGS or value is None:
            continue
        kind, low, high = SETTINGS[key]
        if kind is bool and isinstance(value, str):
            value = value.lower() in ("1", "true", "yes", "on")
        value = kind(value)
        if low is not None:
            value = min(max(value, low), high)
        out[key] = value
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
        take_live_settings: Callable[[], dict] = dict,
        message: Callable[[str], None] = print,
    ):
        super().__init__(default_logging=False, user_message_fun=self._relay)
        # params is the shared axidraw_conf module; give each driver its own copy so per-plot
        # overrides (reach, steps per inch) never leak into the next one.
        self.params = types.SimpleNamespace(**{k: v for k, v in vars(self.params).items() if not k.startswith("__")})
        self.params.check_updates = False
        self._message = message
        self._on_path_start = on_path_start
        self._on_path_done = on_path_done
        self._pause_requested = pause_requested
        self._take_live_settings = take_live_settings
        self._remote_pause = False
        self.force_pen = False  # manual raise/lower: move even if the EBB says the pen is already there
        self._entering: str | None = None  # name of the "!" layer being entered
        self.pen_change: str | None = None  # set when the plot stopped for a pen change: the next layer

    def _relay(self, text):
        # A remote pause goes through the driver's forced-pause path, which credits a layer name.
        if str(text).startswith("Plot paused by layer name control"):
            if self._entering is not None:
                text = f"Paused for a pen change: next layer {self._entering}"
            elif self._remote_pause:
                text = "Plot paused."
        self._message(text)

    def configure(self, svg: str, settings: dict, mode: str = "plot", layer: int | None = None, preview: bool = False):
        self.plot_setup(svg)
        for key, value in clean_settings(settings).items():
            if key in ("reach_x", "reach_y"):
                if value > 0:  # every model, so the override holds whichever one is selected
                    for name in TRAVEL_PARAMS:
                        setattr(self.params, f"{key[-1]}_travel_{name}", value / 25.4)
                continue
            if key == "steps_per_inch":
                if value > 0:
                    self.params.native_res_factor = value
                continue
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

    def ServoSetupWrapper(self):  # noqa: N802 - overrides the driver's name
        super().ServoSetupWrapper()
        if self.options.mode == "manual" and self.force_pen:
            # The EBB only knows up or down, not at which height; after a height change it would skip
            # the move. Forget the state so pen_raise()/pen_lower() always go to the set height.
            self.pen_up = None
            return
        if self.options.mode in ("res_plot", "res_home") and not self.options.preview:
            # Resuming. The driver only trusts the EBB's idea of the pen, and pen_raise() does nothing
            # in resume mode, so a pen that is physically down here (lowered by hand while paused,
            # drooped after the servo timed out, or re-heightened) would be dragged along the moves to
            # come. Physically raise it first, whatever the EBB says.
            resuming, self.resume_mode = self.resume_mode, False
            self.pen_up = None
            self.pen_raise()
            self.resume_mode = resuming

    def DoWePlotLayer(self, str_layer_name):  # noqa: N802 - overrides the driver's name
        # A layer named "!..." makes the driver pause inside this call; remember which one.
        name = str(str_layer_name).strip()
        self._entering = name[1:].strip() if name.startswith("!") else None
        try:
            return super().DoWePlotLayer(str_layer_name)
        finally:
            if self._entering is not None and self.b_stopped:
                self.pen_change = self._entering
            self._entering = None

    def PauseResumeCheck(self):  # noqa: N802 - overrides the driver's name
        # Runs before every motion segment, on the plot thread: the place to change course.
        changes = self._take_live_settings()
        if changes:
            self.apply_live_settings(changes)
        if not self.b_stopped and self._pause_requested():
            self.force_pause = True
            self._remote_pause = True
        super().PauseResumeCheck()

    def apply_live_settings(self, changes: dict) -> None:
        """Change speed, acceleration and pen settings mid-plot.

        Uses the same calls the driver makes when a layer name overrides speed or pen height.
        A new pen height is applied straight away if the pen is already at that end of its travel.
        """
        changes = {k: v for k, v in clean_settings(changes).items() if k in LIVE_SETTINGS}
        for key, value in changes.items():
            setattr(self.options, key, value)
        self.EnableMotors()  # recomputes speed limits
        self.ServoSetup()  # sends pen positions and rates to the EBB
        if self.options.preview or self.resume_mode or self.serial_port is None:
            return
        if self.pen_up is False and "pen_pos_down" in changes:
            ebb_motion.sendPenDown(self.serial_port, 0)
        elif self.pen_up and "pen_pos_up" in changes:
            ebb_motion.sendPenUp(self.serial_port, 0)
