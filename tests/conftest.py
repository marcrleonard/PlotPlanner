import threading

import pytest
import serial
import serial.tools.list_ports

SAMPLE_SVG = """<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="200mm" height="100mm" viewBox="0 0 200 100">
  <g inkscape:groupmode="layer" inkscape:label="rings">
    <circle cx="50" cy="50" r="20" stroke="black" fill="none"/>
    <circle cx="50" cy="50" r="30" stroke="black" fill="none"/>
  </g>
  <g inkscape:groupmode="layer" inkscape:label="wave">
    <path d="M100 50 L150 20 L190 80" stroke="red" fill="none"/>
    <rect x="120" y="60" width="20" height="10" stroke="red" fill="none"/>
  </g>
</svg>"""


class FakeEBB:
    """Enough of an EiBotBoard for the driver: answers queries, OKs everything else."""

    instances = []
    board = {"pen_up": True, "lv": 0}  # pen state, and the EBB's spare variable (EBBLV)

    def __init__(self, port=None, timeout=None, **kwargs):
        self.port = port
        self.is_open = True
        self.commands = []
        self._out = []
        self.board = FakeEBB.board  # one physical board behind every port the driver opens
        self._lock = threading.Lock()
        FakeEBB.instances.append(self)

    def write(self, data):
        assert isinstance(data, bytes), "pyserial 3 needs bytes"
        cmd = data.decode("ascii").strip()
        name = cmd.split(",")[0].upper()
        with self._lock:
            self.commands.append(cmd)
            if name == "V":
                self._out.append(b"EBBv13_and_above EB Firmware Version 2.5.3\r\n")
            elif name == "QB":
                self._out += [b"0\r\n", b"OK\r\n"]
            elif name == "QP":
                self._out += [b"1\r\n" if self.board['pen_up'] else b"0\r\n", b"OK\r\n"]
            elif name == "QC":
                self._out += [b"0394,0300\r\n", b"OK\r\n"]
            elif name == "QL":
                self._out += [f"{self.board['lv']}\r\n".encode(), b"OK\r\n"]
            elif name == "QM":
                self._out.append(b"QM,0,0,0,0\r\n")
            else:
                if name == "SP":
                    self.board['pen_up'] = cmd.split(",")[1] == "1"
                elif name == "SL":
                    self.board['lv'] = int(cmd.split(",")[1])
                self._out.append(b"OK\r\n")
        return len(data)

    def readline(self):
        with self._lock:
            return self._out.pop(0) if self._out else b""

    def flushInput(self):  # noqa: N802
        pass

    reset_input_buffer = flushInput

    def close(self):
        self.is_open = False


@pytest.fixture
def fake_ebb(monkeypatch):
    FakeEBB.instances = []
    FakeEBB.board = {"pen_up": True, "lv": 0}
    monkeypatch.setattr(serial, "Serial", FakeEBB)
    port = ("/dev/ttyACM0", "EiBotBoard", "USB VID:PID=04D8:FD92")
    monkeypatch.setattr(serial.tools.list_ports, "comports", lambda: [port])
    return FakeEBB


@pytest.fixture
def no_ebb(monkeypatch):
    monkeypatch.setattr(serial.tools.list_ports, "comports", lambda: [])


@pytest.fixture
def sample_svg():
    return SAMPLE_SVG
