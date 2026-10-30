"""PlotPlanner: load, optimize and plot SVGs on an iDraw/AxiDraw pen plotter."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("plotplanner")
except PackageNotFoundError:
    __version__ = "0+unknown"
