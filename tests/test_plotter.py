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


def test_pen_change_pause_between_layers(fake_ebb, fast, prepared):
    p = Plotter()
    p.plot(prepared, pen_changes=True)
    assert p.wait(60)
    s = p.status()
    assert s["state"] == PAUSED and s["pen_change"] == "2 wave"
    assert s["completed"] == ["pp_1", "pp_2"]  # all of layer 1, none of layer 2
    assert "Paused for a pen change: next layer 2 wave" in s["messages"]
    p.manual("raise_pen")  # allowed while paused, for the swap
    p.resume()
    assert p.wait(60)
    s = p.status()
    assert s["state"] == IDLE and s["pen_change"] is None and s["paths_done"] == 4


def test_no_pen_change_pause_for_a_single_layer(fake_ebb, fast, prepared):
    p = Plotter()
    p.plot(prepared, layer=2, pen_changes=True)
    assert p.wait(60)
    assert p.status()["state"] == IDLE and p.status()["completed"] == ["pp_3", "pp_4"]


def first(commands, prefix):
    return next((i for i, c in enumerate(commands) if c.startswith(prefix)), None)


def test_resume_raises_the_pen_before_moving(fake_ebb, fast, prepared):
    # The pen-swap bug: lowering the pen by hand while paused (or the servo timing out) left it down,
    # and resume only trusted the EBB, so the next travel move dragged a line.
    p = Plotter()
    p.plot(prepared)
    wait_for(lambda: p.status()["paths_done"] >= 1)
    p.pause()
    p.wait(20)
    p.manual("lower_pen")
    p.resume()
    assert p.wait(60) and p.status()["paths_done"] == 4
    resumed = fake_ebb.instances[-1].commands
    raise_at, move_at = first(resumed, "SP,1"), first(resumed, "SM,")
    assert raise_at is not None and move_at is not None and raise_at < move_at


def test_home_while_paused_then_resume(fake_ebb, fast, prepared):
    p = Plotter()
    p.plot(prepared)
    wait_for(lambda: p.status()["paths_done"] >= 1)
    p.pause()
    p.wait(20)
    done = p.status()["paths_done"]
    p.home()
    assert p.wait(30)
    s = p.status()
    assert s["state"] == PAUSED and s["paths_done"] == done
    homing = fake_ebb.instances[-1].commands
    assert first(homing, "SP,1") < first(homing, "SM,")  # pen up, then the trip home
    p.resume()  # back out to where it paused, and on
    assert p.wait(60) and p.status()["state"] == IDLE and p.status()["paths_done"] == 4


def test_home_only_while_paused(fake_ebb, prepared):
    p = Plotter()
    with pytest.raises(PlotterBusy):
        p.home()


def test_pen_buttons_always_move_the_pen(fake_ebb):
    # After a height change the EBB still says "up", and the driver would skip the move;
    # the buttons must go to the newly set height regardless.
    p = Plotter()
    p.manual("raise_pen")
    p.update_settings({"pen_pos_up": 10})
    p.manual("raise_pen")
    assert any(c.startswith("SP,1") for c in fake_ebb.instances[-1].commands)
    p.manual("lower_pen")
    p.manual("lower_pen")
    assert any(c.startswith("SP,0") for c in fake_ebb.instances[-1].commands)


def motor_steps(commands):
    """Total steps sent to motor 1 by SM moves."""
    return sum(int(c.split(",")[2]) for c in commands if c.startswith("SM,"))


def test_jog_tracks_offset_and_returns_to_start(fake_ebb, fast):
    p = Plotter()
    assert p.jog(10, 5) == [10, 5]
    assert any(c.startswith("SM,") for c in fake_ebb.instances[-1].commands)
    assert p.jog(-30, 0) == [0, 5]  # stops at the start corner instead of the end stop
    p.back_to_start()
    assert p.status()["jog"] == [0, 0]


def test_plot_returns_to_start_after_jogging(fake_ebb, fast, prepared):
    p = Plotter()
    p.jog(20, 0)
    walks_before = len(fake_ebb.instances)
    p.plot(prepared)
    assert p.wait(60) and p.status()["paths_done"] == 4
    assert "Returning to the start corner before plotting." in p.status()["messages"]
    assert len(fake_ebb.instances) == walks_before + 2  # the walk back, then the plot


def test_motors_off_makes_position_unknown(fake_ebb):
    p = Plotter()
    p.manual("disable_xy")
    assert p.status()["jog"] is None
    with pytest.raises(ValueError):
        p.back_to_start()
    p.set_start()
    assert p.status()["jog"] == [0, 0]


def test_steps_per_inch_sets_how_far_it_drives(fake_ebb, fast):
    # High resolution: one inch along X is 2 x steps_per_inch steps on each motor.
    p = Plotter()
    p.jog(25.4, 0)
    assert abs(motor_steps(fake_ebb.instances[-1].commands) - 2 * 1270) <= 2
    p.update_settings({"steps_per_inch": 1016})
    p.jog(25.4, 0)
    assert abs(motor_steps(fake_ebb.instances[-1].commands) - 2 * 1016) <= 2


def test_reach_override_reaches_the_driver():
    ad = driver.Driver()
    ad.configure(None, {**driver.DEFAULT_SETTINGS, "reach_x": 420, "reach_y": 290}, mode="manual", preview=True)
    assert abs(ad.params.x_travel_V3A3 * 25.4 - 420) < 1e-6 and abs(ad.params.y_travel_default * 25.4 - 290) < 1e-6
