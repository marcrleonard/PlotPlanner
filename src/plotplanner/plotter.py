"""Plot controller: one worker thread owns the serial port; the API only flips flags and reads state."""

from __future__ import annotations

import logging
import threading
import time
from collections import deque

from . import driver, optimize

log = logging.getLogger(__name__)

IDLE, PLOTTING, PAUSED, STOPPING = "idle", "plotting", "paused", "stopping"
DRIVER_LOGGERS = ("axidrawinternal", "plotink")


class _MessageHandler(logging.Handler):
    """Surfaces the driver's warnings and errors in status messages."""

    def __init__(self, sink):
        super().__init__(logging.WARNING)
        self.sink = sink

    def emit(self, record):
        self.sink(record.getMessage())


class PlotterBusy(RuntimeError):
    pass


class Plotter:
    def __init__(self, settings: dict | None = None, preview: bool = False):
        """preview=True simulates plots without hardware (the driver's preview mode)."""
        self.preview = preview
        self.settings = {**driver.DEFAULT_SETTINGS, **driver.clean_settings(settings)}

        self._lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self._pause = threading.Event()
        self._stop = threading.Event()
        self._live: dict = {}  # setting changes waiting for the plot thread to pick up

        self.state = IDLE
        self.plot_id = 0  # bumps on every new plot so clients know to reload the document
        self.svg: str | None = None  # the document being plotted
        self._resume_svg: str | None = None  # driver output carrying resume data
        self.layer: int | None = None
        self.pen_change: str | None = None  # paused waiting for this layer's pen ("2 waves")
        self.paths_total = 0
        self.current_path: str | None = None
        self.completed: list[str] = []
        self._completed_set: set[str] = set()
        self.started_at: float | None = None
        self.error: str | None = None
        self.messages: deque[str] = deque(maxlen=50)

    # ---------------------------------------------------------------- commands

    def plot(self, svg: str, settings: dict | None = None, layer: int | None = None, pen_changes: bool = False) -> None:
        """pen_changes: when plotting all layers, pause before each layer after the first."""
        if self.state != IDLE:
            raise PlotterBusy(f"plotter is {self.state}")
        if not optimize.is_prepared(svg):
            svg = optimize.optimize(svg, optimize.AS_IS)["svg"]  # numbers the paths; outside the lock
        if pen_changes and layer is None:
            svg = optimize.add_pen_changes(svg)
        with self._lock:
            if self.state != IDLE:
                raise PlotterBusy(f"plotter is {self.state}")
            if settings:
                self.update_settings(settings)
            self.svg = svg
            self.plot_id += 1
            self._resume_svg = None
            self.layer = layer
            self.paths_total = svg.count(f'id="{optimize.PATH_ID_PREFIX}')
            self.current_path = None
            self.completed = []
            self._completed_set = set()
            self.error = None
            self.started_at = time.time()
            self._start("plot", svg)

    def pause(self) -> None:
        with self._lock:
            if self.state != PLOTTING:
                raise PlotterBusy(f"cannot pause while {self.state}")
            self._pause.set()

    def resume(self) -> None:
        with self._lock:
            if self.state != PAUSED:
                raise PlotterBusy(f"cannot resume while {self.state}")
            self._start("res_plot", self._resume_svg)

    def stop(self) -> None:
        """Stop the plot, raise the pen and drive home."""
        with self._lock:
            if self.state == PLOTTING:
                self._stop.set()
                self._pause.set()
                self.state = STOPPING
            elif self.state == PAUSED:
                self._stop.set()
                self._message("Stopping: returning home.")
                self._start("res_home", self._resume_svg, state=STOPPING)
            elif self.state != STOPPING:
                raise PlotterBusy("nothing to stop")

    def manual(self, command: str) -> list[str]:
        """Run a one-off command (raise_pen, lower_pen, disable_xy, ...). Returns driver messages."""
        if command not in driver.MANUAL_COMMANDS:
            raise ValueError(f"unknown command {command!r}; use one of {driver.MANUAL_COMMANDS}")
        with self._lock:
            allowed = self.state == IDLE or (self.state == PAUSED and command in ("raise_pen", "lower_pen"))
            if not allowed:
                raise PlotterBusy(f"cannot run {command} while {self.state}")
            output: list[str] = []
            ad = driver.Driver(message=lambda m: (output.append(str(m).strip()), self._message(m)))
            ad.configure(None, self.settings, mode="manual", preview=self.preview)
            ad.options.manual_cmd = command
            ad.plot_run()
            return [m for m in output if m]

    def update_settings(self, settings: dict) -> dict:
        """Change settings. During a plot, speed and pen settings take effect from the next
        motion segment; machine size, resolution, rotation and port are locked until it ends."""
        new = driver.clean_settings(settings)
        with self._lock:
            changed = {k: v for k, v in new.items() if self.settings.get(k) != v}
            if self.state != IDLE:
                locked = sorted(k for k in changed if k not in driver.LIVE_SETTINGS)
                if locked:
                    raise PlotterBusy(f"cannot change {', '.join(locked)} while {self.state}")
                if self.state == PLOTTING:
                    self._live.update(changed)
            self.settings.update(new)
            return dict(self.settings)

    def reset_settings(self) -> dict:
        return self.update_settings(driver.DEFAULT_SETTINGS)

    # ---------------------------------------------------------------- queries

    def status(self, since: int = 0) -> dict:
        """since: how many completed path ids the client already has."""
        with self._lock:
            since = max(0, min(since, len(self.completed)))
            return {
                "state": self.state,
                "plot_id": self.plot_id,
                "preview": self.preview,
                "layer": self.layer,
                "pen_change": self.pen_change,
                "paths_total": self.paths_total,
                "paths_done": len(self.completed),
                "current_path": self.current_path,
                "completed_since": since,
                "completed": self.completed[since:],
                "elapsed": round(time.time() - self.started_at, 1) if self.started_at else None,
                "error": self.error,
                "messages": list(self.messages)[-10:],
                "settings": dict(self.settings),
            }

    def connection(self) -> dict:
        with self._lock:
            busy = self.state != IDLE
        if self.preview:
            return {"connected": True, "busy": busy, "ports": ["preview"]}
        if busy:
            return {"connected": True, "busy": True, "ports": []}
        ports = driver.list_ports()
        return {"connected": bool(ports), "busy": False, "ports": ports}

    def wait(self, timeout: float | None = None) -> bool:
        """Block until the worker finishes. True if it did."""
        thread = self._thread
        if thread:
            thread.join(timeout)
            return not thread.is_alive()
        return True

    # ---------------------------------------------------------------- worker

    def _start(self, mode: str, svg: str, state: str = PLOTTING) -> None:
        self._pause.clear()
        self.pen_change = None
        self._live = {}  # a new driver starts from self.settings anyway
        if mode != "res_home":
            self._stop.clear()
        self.state = state
        self._thread = threading.Thread(target=self._run, args=(mode, svg), name=f"plot-{mode}", daemon=True)
        self._thread.start()

    def _run(self, mode: str, svg: str) -> None:
        try:
            out, stopped, pen_change = self._drive(mode, svg)
            if stopped and self._stop.is_set():
                self._message("Stopping: returning home.")
                self._drive("res_home", out)
                stopped = False
            with self._lock:
                self.current_path = None
                if stopped:
                    self._resume_svg = out
                    self.pen_change = pen_change
                    self.state = PAUSED
                else:
                    self._resume_svg = None
                    self.state = IDLE
        except BaseException as exc:  # the driver calls quit() on some errors
            log.exception("plot failed")
            with self._lock:
                self.error = str(exc) or type(exc).__name__
                self.current_path = None
                self.state = IDLE
        finally:
            self._pause.clear()
            self._stop.clear()

    def _drive(self, mode: str, svg: str) -> tuple[str, bool, str | None]:
        """Run the driver once. Returns (output svg with resume data, whether it stopped early,
        the layer it stopped for if that was a pen change)."""
        ad = driver.Driver(
            on_path_start=self._path_start,
            on_path_done=self._path_done,
            pause_requested=self._pause.is_set,
            take_live_settings=self._take_live_settings,
            message=self._message,
        )
        ad.configure(svg, self.settings, mode=mode, layer=self.layer, preview=self.preview)
        handler = _MessageHandler(self._message)
        for name in DRIVER_LOGGERS:
            logging.getLogger(name).addHandler(handler)
        try:
            out = ad.plot_run(output=True)
        finally:
            for name in DRIVER_LOGGERS:
                logging.getLogger(name).removeHandler(handler)
        if ad.serial_port is None and not self.preview:
            raise RuntimeError("no plotter found")
        return out, bool(ad.b_stopped), ad.pen_change

    def _take_live_settings(self) -> dict:
        with self._lock:
            changes, self._live = self._live, {}
        if changes:
            self._message("Applied: " + ", ".join(f"{k} {v}" for k, v in sorted(changes.items())))
        return changes

    def _path_start(self, path_id: str | None) -> None:
        with self._lock:
            self.current_path = path_id

    def _path_done(self, path_id: str | None) -> None:
        with self._lock:
            if path_id and path_id not in self._completed_set:
                self._completed_set.add(path_id)
                self.completed.append(path_id)

    def _message(self, message) -> None:
        text = str(message).strip()
        if text:
            log.info(text)
            with self._lock:
                self.messages.append(text)
