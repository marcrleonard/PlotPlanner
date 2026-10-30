"""Command line: run the server, or optimize and plot directly."""

from __future__ import annotations

import logging
import time
from pathlib import Path

import click

from . import optimize as opt
from .plotter import IDLE, PAUSED, Plotter


def optimize_options(func):
    """Shared options for commands that run the vpype pipeline."""
    options = [
        click.option("--paper", default="a3", show_default=True,
                     help=f"{', '.join(opt.PAPER_SIZES)}, WxH in mm, or 'source' to keep the page."),
        click.option("--orientation", type=click.Choice(opt.ORIENTATIONS), default="auto", show_default=True),
        click.option("--margin", type=float, default=15.0, show_default=True, help="Margin in mm."),
        click.option("--fit/--no-fit", default=True, show_default=True, help="Scale to fill the margins."),
        click.option("--two-opt", is_flag=True, help="Slower, shorter travel."),
        click.option("--reloop", is_flag=True, help="Re-pick start points of closed paths."),
        click.option("--layers-from", type=click.Choice(opt.LAYER_SOURCES), default="groups", show_default=True,
                     help="What becomes a layer (a pen): top-level groups or stroke colours."),
    ]
    for option in reversed(options):
        func = option(func)
    return func


def _options(paper, orientation, margin, fit, two_opt, reloop, layers_from) -> opt.OptimizeOptions:
    return opt.OptimizeOptions.from_dict(
        dict(paper=paper, orientation=orientation, margin=margin, fit=fit, two_opt=two_opt, reloop=reloop,
             layers_from=layers_from)
    )


def _report(result: dict) -> None:
    b, a = result["before"], result["after"]
    click.echo(f"paths {b['paths']} -> {a['paths']}, pen-up travel {b['travel_mm']} mm -> {a['travel_mm']} mm, "
               f"drawing {a['draw_mm']} mm, layers {', '.join(str(layer['id']) for layer in result['layers'])}", err=True)


@click.group()
@click.version_option(package_name="plotplanner")
@click.option("-v", "--verbose", is_flag=True)
def cli(verbose):
    """Plot SVGs on an iDraw/AxiDraw pen plotter."""
    logging.basicConfig(level=logging.INFO if verbose else logging.WARNING, format="%(message)s")


@cli.command()
@click.option("--host", default="127.0.0.1", show_default=True, help="Use 0.0.0.0 to allow remote control.")
@click.option("--port", default=5001, show_default=True)
@click.option("--token", envvar="PLOTPLANNER_TOKEN", help="Require this bearer token on the API. [env: PLOTPLANNER_TOKEN]")
@click.option("--preview", is_flag=True, help="Simulate plots without a plotter.")
def serve(host, port, token, preview):
    """Run the API and the control page."""
    from .server import serve as run

    if host not in ("127.0.0.1", "localhost") and not token:
        click.echo("Warning: listening on the network without --token; anyone who can reach it can plot.", err=True)
    click.echo(f"PlotPlanner on http://{'localhost' if host == '0.0.0.0' else host}:{port}", err=True)
    run(host=host, port=port, token=token, preview=preview)


@cli.command()
@click.argument("source", type=click.File("r"))
@click.option("-o", "--output", type=click.Path(dir_okay=False, path_type=Path), help="Defaults to stdout.")
@optimize_options
def optimize(source, output, **kwargs):
    """Sort, merge and lay out an SVG for plotting."""
    result = opt.optimize(source.read(), _options(**kwargs))
    _report(result)
    if output:
        output.write_text(result["svg"])
    else:
        click.echo(result["svg"])


@cli.command()
@click.argument("source", type=click.File("r"))
@click.option("--as-is", is_flag=True, help="Plot without optimizing.")
@click.option("--layer", type=int, help="Plot only this layer.")
@click.option("--pen-changes", is_flag=True, help="Pause before each layer after the first to swap pens.")
@click.option("--preview", is_flag=True, help="Simulate without a plotter.")
@optimize_options
def plot(source, as_is, layer, pen_changes, preview, **kwargs):
    """Plot an SVG. Ctrl-C pauses; Ctrl-C again stops and returns home."""
    from .server import load_settings

    svg = source.read()
    result = opt.optimize(svg, opt.AS_IS if as_is else _options(**kwargs))
    _report(result)

    plotter = Plotter(settings=load_settings(), preview=preview)
    plotter.plot(result["svg"], layer=layer, pen_changes=pen_changes)
    shown = None
    while True:
        try:
            while not plotter.wait(0.5):
                s = plotter.status()
                line = f"{s['state']}: {s['paths_done']}/{s['paths_total']} paths"
                if line != shown:
                    click.echo(f"\r{line}  ", nl=False, err=True)
                    shown = line
            if plotter.state != PAUSED:
                break
            s = plotter.status()
            if s["pen_change"]:
                click.echo(f"\nPen change: put in the pen for layer {s['pen_change']}.", err=True)
            click.echo("\nPaused. Enter to resume, Ctrl-C to stop and go home.", err=True)
            input()
            plotter.resume()
        except KeyboardInterrupt:
            if plotter.state == IDLE:
                break
            if plotter.state == PAUSED:
                plotter.stop()
            else:
                try:
                    plotter.pause()
                except RuntimeError:
                    pass
            time.sleep(0.1)

    s = plotter.status()
    click.echo(f"\n{s['state']}: {s['paths_done']}/{s['paths_total']} paths in {s['elapsed']} s", err=True)
    if s["error"]:
        raise click.ClickException(s["error"])


@cli.command()
def connection():
    """List connected plotters."""
    ports = Plotter().connection()["ports"]
    click.echo("\n".join(ports) if ports else "No plotter found.")


def _manual(command: str) -> None:
    from .server import load_settings

    for line in Plotter(settings=load_settings()).manual(command):
        click.echo(line)


@cli.command()
@click.argument("position", type=click.Choice(["up", "down"]))
def pen(position):
    """Raise or lower the pen."""
    _manual("raise_pen" if position == "up" else "lower_pen")


@cli.command()
@click.argument("state", type=click.Choice(["on", "off"]))
def motors(state):
    """Enable or disable the motors (off lets you move the carriage by hand)."""
    _manual("enable_xy" if state == "on" else "disable_xy")


@cli.command()
def version():
    """Print the plotter's firmware version."""
    _manual("fw_version")
