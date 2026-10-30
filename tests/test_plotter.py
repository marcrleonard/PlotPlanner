import time
import types

import pytest

from plotplanner import driver, optimize
from plotplanner.plotter import IDLE, PAUSED, Plotter, PlotterBusy


@pytest.fixture
def fast(monkeypatch):
    """Run the driver's real-time waits at 1/20th speed."""
    real = time
    fake = types.SimpleNamespace(**{n: getattr(real, n) for n in dir(real) if not n.startswith("__")})
    fake.sleep = lambda s: real.sleep(s / 20)
    monkeypatch.setattr(driver.axidraw, "time", fake)


@pytest.fixture
def prepared(sample_svg):
    return optimize.optimize(sample_svg, {"paper": "a4"})["svg"]


def wait_for(cond, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    raise AssertionError("timed out")


def test_preview_plot_reports_every_path(prepared):
    p = Plotter(preview=True)
    p.plot(prepared)
    assert p.wait(30)
    s = p.status()
    assert s["state"] == IDLE and s["error"] is None
    assert s["completed"] == ["pp_1", "pp_2", "pp_3", "pp_4"] and s["paths_total"] == 4
    assert p.status(since=3)["completed"] == ["pp_4"]


def test_unprepared_svg_is_numbered_before_plotting(sample_svg):
    p = Plotter(preview=True)
    p.plot(sample_svg)
    p.wait(30)
    assert p.status()["paths_done"] == 4


def test_layer_mode_plots_one_layer(prepared):
    p = Plotter(preview=True)
    p.plot(prepared, layer=2)
    p.wait(30)
    assert p.status()["completed"] == ["pp_3", "pp_4"]


def test_plot_on_fake_ebb_opens_and_closes_one_port(fake_ebb, fast, prepared):
    p = Plotter()
    assert p.connection() == {"connected": True, "busy": False, "ports": ["/dev/ttyACM0"]}
    p.plot(prepared, settings={"pen_pos_up": 60, "pen_pos_down": 30})
    assert p.wait(60)
    assert p.status()["paths_done"] == 4 and p.status()["error"] is None
    assert len(fake_ebb.instances) == 1 and not fake_ebb.instances[0].is_open
    commands = fake_ebb.instances[0].commands
    assert any(c.startswith("SM,") or c.startswith("XM,") for c in commands)
    # iDraw servo range 7500-28000: 60% -> 19800 for pen-up
    assert "SC,4,19800" in commands


def test_pause_resume(fake_ebb, fast, prepared):
    p = Plotter()
    p.plot(prepared)
    wait_for(lambda: p.status()["paths_done"] >= 1)
    p.pause()
    assert p.wait(20)
    s = p.status()
    assert s["state"] == PAUSED and s["paths_done"] < 4
    assert "Plot paused." in s["messages"]
    with pytest.raises(PlotterBusy):
        p.plot(prepared)
    p.resume()
    assert p.wait(60)
    assert p.status()["state"] == IDLE and p.status()["paths_done"] == 4
    assert all(not port.is_open for port in fake_ebb.instances)


def test_stop_while_plotting_goes_home(fake_ebb, fast, prepared):
    p = Plotter()
    p.plot(prepared)
    wait_for(lambda: p.status()["paths_done"] >= 1)
    p.stop()
    assert p.wait(60)
    s = p.status()
    assert s["state"] == IDLE and s["paths_done"] < 4
    assert "Stopping: returning home." in s["messages"]
    assert len(fake_ebb.instances) == 2  # the plot, then the trip home


def test_stop_while_paused(fake_ebb, fast, prepared):
    p = Plotter()
    p.plot(prepared)
    wait_for(lambda: p.status()["paths_done"] >= 1)
    p.pause()
    p.wait(20)
    p.stop()
    assert p.wait(60)
    assert p.state == IDLE


def test_no_plotter(no_ebb, prepared):
    p = Plotter()
    assert p.connection()["connected"] is False
    p.plot(prepared)
    p.wait(10)
    assert p.status()["state"] == IDLE and p.status()["error"] == "no plotter found"


def test_manual_commands(fake_ebb):
    p = Plotter()
    p.manual("raise_pen")
    assert any(c.startswith("SP,1") for c in fake_ebb.instances[-1].commands)
    with pytest.raises(ValueError):
        p.manual("format_disk")


def test_settings_are_cleaned():
    p = Plotter(settings={"pen_pos_up": "55", "const_speed": "true", "bogus": 1})
    assert p.settings["pen_pos_up"] == 55 and p.settings["const_speed"] is True and "bogus" not in p.settings


def servo(percent):
    """EBB servo value for a pen position on the iDraw (servo range 7500-28000)."""
    return round(7500 + (28000 - 7500) / 100 * percent)


def test_live_settings_apply_mid_plot(fake_ebb, fast, prepared):
    p = Plotter()
    p.plot(prepared, settings={"pen_pos_down": 45})
    wait_for(lambda: p.status()["paths_done"] >= 1)
    p.update_settings({"pen_pos_down": 30, "speed_pendown": 60})
    wait_for(lambda: any(m.startswith("Applied:") for m in p.status()["messages"]))
    assert p.wait(60) and p.status()["paths_done"] == 4
    commands = fake_ebb.instances[0].commands
    first, new = commands.index(f"SC,5,{servo(45)}"), commands.index(f"SC,5,{servo(30)}")
    assert first < new
    assert "Applied: pen_pos_down 30, speed_pendown 60" in p.status()["messages"]
    assert p.settings["pen_pos_down"] == 30  # kept for the next plot


def test_locked_settings_refused_mid_plot(fake_ebb, fast, prepared):
    p = Plotter()
    p.plot(prepared)
    wait_for(lambda: p.status()["paths_done"] >= 1)
    with pytest.raises(PlotterBusy, match="model"):
        p.update_settings({"model": 1, "pen_pos_up": 30})
    assert p.settings["pen_pos_up"] == 20  # all or nothing
    p.update_settings({"model": p.settings["model"]})  # unchanged is fine
    p.stop()
    p.wait(60)
    p.update_settings({"model": 1})  # idle again


def test_settings_changed_while_paused_apply_on_resume(fake_ebb, fast, prepared):
    p = Plotter()
    p.plot(prepared)
    wait_for(lambda: p.status()["paths_done"] >= 1)
    p.pause()
    p.wait(20)
    p.update_settings({"pen_pos_down": 35})
    p.resume()
    assert p.wait(60)
    assert f"SC,5,{servo(35)}" in fake_ebb.instances[-1].commands


def test_settings_are_clamped():
    p = Plotter(settings={"pen_pos_up": 250, "speed_pendown": 0})
    assert p.settings["pen_pos_up"] == 100 and p.settings["speed_pendown"] == 1
