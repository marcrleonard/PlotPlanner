import pytest

from plotplanner.plotter import Plotter
from plotplanner.server import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app(Plotter(preview=True), settings_file=tmp_path / "settings.json")
    return app.test_client()


def test_page_and_info(client):
    assert client.get("/").status_code == 200
    info = client.get("/api/info").get_json()
    assert "a3" in info["paper_sizes"] and info["preview"] is True
    assert info["machine_travel_mm"]["2"] == [430, 297]


def test_optimize_plot_status(client, sample_svg):
    optimized = client.post("/api/optimize", json={"svg": sample_svg, "options": {"paper": "a4"}}).get_json()
    assert optimized["paths"] == 4
    assert client.post("/api/plot", json={"svg": optimized["svg"], "layer": 1}).status_code == 200
    client.application.extensions["plotter"].wait(30)
    status = client.get("/api/status").get_json()
    assert status["state"] == "idle" and status["completed"] == ["pp_1", "pp_2"]
    assert client.get("/api/document").get_json()["svg"] == optimized["svg"]


def test_errors(client):
    assert client.post("/api/plot", json={}).status_code == 400
    assert client.post("/api/pause").status_code == 409
    assert client.post("/api/manual", json={"command": "nope"}).status_code == 400


def test_settings_persist(client, tmp_path):
    assert client.post("/api/settings", json={"pen_pos_up": 70}).get_json()["pen_pos_up"] == 70
    assert '"pen_pos_up": 70' in (tmp_path / "settings.json").read_text()
    assert client.post("/api/settings", json={"reset": True}).get_json()["pen_pos_up"] == 20


def test_token(tmp_path):
    client = create_app(Plotter(preview=True), token="s3cret", settings_file=None).test_client()
    assert client.get("/api/status").status_code == 401
    assert client.get("/api/status", headers={"Authorization": "Bearer s3cret"}).status_code == 200
    assert client.get("/").status_code == 200  # the page itself is public; it asks for the token
