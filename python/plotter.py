import sys
sys.path.append('.')
from python.plotcontrol.idraw import WCB

input_options = {
    # "tab": "timing",
    "tab": "splash",
    "penUpPosition": 20,
    "penDownPosition": 50, # this is the movement ACTUALLY drawing
    # "laserPower": 50,
    # "setupType": 'align-mode',
    "penDownSpeed": 20,  # this is the movement when NOT drawing
    "rapidSpeed": 50,
    "ServoUpSpeed": 40,
    "penUpDelay": 0,
    "ServoDownSpeed": 40,
    "penDownDelay": 0,
    "autoRotate": True,
    "constSpeed": False,
    # "report_time": True,
    "resolution": 1,
    "smoothness": 10,
    "cornering": 10,
    "manualType": 'none',
    "WalkDistance": 1,
    "resumeType": 'ResumeNow',
    "layernumber": 1,

}



# e = WCB(input_options, filename = '/Users/marcleonard/Desktop/Poster_v3_A3.ai.svg')
# e = WCB(input_options, filename = '/Users/marcleonard/Projects/plotplanner/python/circle.svg')

# filename = '/Users/marcleonard/Projects/plotplanner/python/tree_test.svg'
# filename = '/Users/marcleonard/Projects/plotplanner/python/tree_inkscape_text.svg'
filename = '/Users/marcleonard/Projects/plotplanner/python/tree_test_text.svg'

import threading

class PlotControl():
    def __init__(self, input_options, filename):
        self.input_options = input_options
        self.filename = filename
        self.operation = None

    def run(self):
        self.run_thread = threading.Thread(target=self._run)
        self.run_thread.start()

        while self.run_thread.is_alive():
            user_input = input()
            if user_input == 'stop':
                self.stop()


    def _run(self):
        self.operation = WCB(self.input_options, self.filename)
        self.operation.effect()


    def stop(self):
        self.operation.run = False
        self.operation.ptFirst = [0,0]
        self.operation.penUp()
        self.operation.sendDisableMotors()

    def version(self):
        self.input_options = {'tab':'manual', 'manualType':'version-check'}
        self.operation = WCB(self.input_options, self.filename)
        self.operation.effect()


pc = PlotControl(input_options, filename)
# pc.version()
pc.run()
