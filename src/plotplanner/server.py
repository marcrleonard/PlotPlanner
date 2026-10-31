"""HTTP API plus the static control page.

Everything lives under /api so the page in static/ can be served from here or from anywhere
else (it asks for the server URL). Set a token to require `Authorization: Bearer <token>`.
"""

from __future__ import annotations

import hmac
import json
import logging
from pathlib import Path

import click
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from . import __version__, driver, optimize
from .plotter import Plotter, PlotterBusy

STATIC = Path(__file__).parent / "static"
SETTINGS_FILE = Path(click.get_app_dir("plotplanner")) / "settings.json"

log = logging.getLogger(__name__)


def load_settings(path: Path = SETTINGS_FILE) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def save_settings(settings: dict, path: Path = SETTINGS_FILE) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(settings, indent=2))
    except OSError as exc:
        log.warning("could not save settings to %s: %s", path, exc)


def create_app(plotter: Plotter | None = None, token: str | None = None, settings_file: Path | None = SETTINGS_FILE) -> Flask:
    if plotter is None:
        plotter = Plotter(settings=load_settings(settings_file) if settings_file else None)
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 128 * 1024 * 1024
    app.extensions["plotter"] = plotter
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    @app.before_request
    def check_token():
        if not token or not request.path.startswith("/api/") or request.method == "OPTIONS":
            return None
        supplied = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        if not hmac.compare_digest(supplied, token):
            return jsonify(error="missing or wrong token"), 401
        return None

    @app.errorhandler(PlotterBusy)
    def busy(exc):
        return jsonify(error=str(exc), status=plotter.status()), 409

    @app.errorhandler(ValueError)
    def bad_request(exc):
        return jsonify(error=str(exc)), 400

    def body() -> dict:
        return request.get_json(silent=True) or {}

    def require_svg(data: dict) -> str:
        svg = data.get("svg")
        if not svg or not isinstance(svg, str):
            raise ValueError("request needs an 'svg' string")
        return svg

    # ------------------------------------------------------------------ page

    @app.get("/")
    def index():
        return send_from_directory(STATIC, "index.html")

    @app.get("/<path:name>")
    def static_file(name):
        return send_from_directory(STATIC, name)

    # ------------------------------------------------------------------ api

    @app.get("/api/info")
    def info():
        return jsonify(
            version=__version__,
            preview=plotter.preview,
            paper_sizes=optimize.PAPER_SIZES,
            orientations=optimize.ORIENTATIONS,
            positions=optimize.POSITIONS,
            layer_sources=optimize.LAYER_SOURCES,
            machine_travel_mm=driver.machine_travel_mm(),
            pen_reversed=driver.pen_heights_reversed(),
            optimize_defaults=optimize.OptimizeOptions().__dict__,
            settings=plotter.settings,
            setting_defaults=driver.DEFAULT_SETTINGS,
            live_settings=sorted(driver.LIVE_SETTINGS),
            manual_commands=driver.MANUAL_COMMANDS,
            auth=bool(token),
        )

    @app.get("/api/status")
    def status():
        return jsonify(plotter.status(since=request.args.get("since", 0, type=int)))

    @app.get("/api/connection")
    def connection():
        return jsonify(plotter.connection())

    @app.get("/api/document")
    def document():
        """The SVG being plotted, so a client that connects mid-plot can show progress."""
        return jsonify(svg=plotter.svg, layer=plotter.layer)

    @app.post("/api/optimize")
    def optimize_svg():
        data = body()
        return jsonify(optimize.optimize(require_svg(data), data.get("options")))

    @app.post("/api/plot")
    def plot():
        data = body()
        layer = data.get("layer")
        plotter.plot(
            require_svg(data),
            settings=data.get("settings"),
            layer=int(layer) if layer not in (None, "") else None,
            pen_changes=bool(data.get("pen_changes")),
        )
        if data.get("settings") and settings_file:
            save_settings(plotter.settings, settings_file)
        return jsonify(plotter.status())

    @app.post("/api/pause")
    def pause():
        plotter.pause()
        return jsonify(plotter.status())

    @app.post("/api/resume")
    def resume():
        plotter.resume()
        return jsonify(plotter.status())

    @app.post("/api/home")
    def home():
        plotter.home()
        return jsonify(plotter.status())

    @app.post("/api/stop")
    def stop():
        plotter.stop()
        return jsonify(plotter.status())

    @app.post("/api/manual")
    def manual():
        output = plotter.manual(body().get("command", ""))
        return jsonify(output=output, status=plotter.status())

    @app.get("/api/settings")
    def get_settings():
        return jsonify(plotter.settings)

    @app.post("/api/settings")
    def set_settings():
        data = body()
        new = plotter.reset_settings() if data.get("reset") else plotter.update_settings(data)
        if settings_file:
            save_settings(new, settings_file)
        return jsonify(new)

    return app


def serve(host: str = "127.0.0.1", port: int = 5001, token: str | None = None, preview: bool = False) -> None:
    plotter = Plotter(settings=load_settings(), preview=preview)
    app = create_app(plotter, token=token)
    app.run(host=host, port=port, threaded=True, use_reloader=False)
