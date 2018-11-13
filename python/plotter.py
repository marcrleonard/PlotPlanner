import sys

sys.path.append('.')
from python.plotcontrol.plotdriver import PlotDriver



# e = WCB(input_options, filename = '/Users/marcleonard/Desktop/Poster_v3_A3.ai.svg')
# e = WCB(input_options, filename = '/Users/marcleonard/Projects/plotplanner/python/circle.svg')

# filename = '/Users/marcleonard/Projects/plotplanner/python/tree_test.svg'
# filename = '/Users/marcleonard/Projects/plotplanner/python/tree_inkscape_text.svg'
filename = '/Users/marcleonard/Projects/plotplanner/python/tree_test_text.svg'

import threading


class PlotControl():
    def __init__(self, filename, ):

        self.filename = filename

        self.operation = PlotDriver( self.filename)

        self.input_supervisor()

    def set_options(self, options):
        self.operation.set_options(options)

    def run(self):
        input_options = {
            # "tab": "timing",
            "tab": "splash",
            "penUpPosition": 20,
            "penDownPosition": 50,  # this is the movement ACTUALLY drawing
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
        self.set_options(input_options)
        self.run_thread = threading.Thread(target=self._run)
        self.run_thread.start()

    def input_supervisor(self):
        while True:
            user_input = input('Operation: ')

            if user_input == 'run':
                self.run()

            if user_input == 'pause':
                self.pause()

            elif user_input == 'resume':
                self.resume()

            elif user_input == 'stop':
                self.stop()

    # def _input_thread(self):
    #     while True:
    #         user_input = input()
    #         if user_input == 'stop':
    #             self.pause()


    def _run(self):

        self.operation.effect()

    def pause(self):

        self.operation.run = False
        # self.operation.ptFirst = [0,0]
        # self.operation.penUp()
        # self.operation.sendDisableMotors()

    def stop(self):
        self.pause()
        self.operation.ptFirst = [0, 0]
        self.operation.penUp()
        self.operation.sendDisableMotors()

    def resume(self):
        # TODO! I need to set an option 'setter' otherwise, it will be really messy
        # 'reseting' these options if I need to send it multiple commands.
        options = {
            # 'manualType': 'none', 'ServoUpSpeed': '40', 'penDownSpeed': '15', 'layernumber': '1',
            'resumeType': 'ResumeNow',
            'tab': 'resume',
            # 'penUpPosition': '20', 'report_time': 'false', 'autoRotate': 'true', 'penDownPosition': '50',
            # 'ServoDownSpeed': '40', 'smoothness': '10', 'constSpeed': 'false', 'WalkDistance': '1',
            # 'laserPower': '50', 'cornering': '10', 'penUpDelay': '0', 'resolution': '1',
            # 'rapidSpeed': '40', 'setupType': 'align-mode', 'penDownDelay': '0'
        }
        self.set_options(options)
        self.operation.effect()

    def version(self):
        self.input_options = {'tab': 'manual', 'manualType': 'version-check'}
        self.operation = PlotDriver(self.input_options, self.filename)
        self.operation.effect()


pc = PlotControl(filename)
# pc.version()
# pc.run()
