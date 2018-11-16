import sys
import time

sys.path.append('.')
from python.plotcontrol.plotdriver import PlotDriver



# e = WCB(input_options, filename = '/Users/marcleonard/Desktop/Poster_v3_A3.ai.svg')
# e = WCB(input_options, filename = '/Users/marcleonard/Projects/plotplanner/python/circle.svg')

# filename = '/Users/marcleonard/Projects/plotplanner/python/tree_test.svg'
# filename = '/Users/marcleonard/Projects/plotplanner/python/tree_inkscape_text.svg'


import threading


class PlotControl(object):
    def __init__(self, interactive=False):

        self.driver = PlotDriver()

        self.svg_string = None
        self.filename = None

        if interactive:
            self.input_supervisor()

    def check_connection(self):
        rv = True
        connection = self.driver.openPort()
        if not connection:
            rv = False
            # print('No plotter found :-(')

        return rv


    def set_options(self, options):
        self.driver.set_options(options)

    def run(self, filename=None, svg_string=None):

        self.filename = filename
        self.svg_string = svg_string

        if svg_string:
            self.driver.svg_string = self.svg_string
        elif filename:
            self.driver.filename = self.filename

        else:
            print('No input provided.')
            return False

        rv = False

        status = self.status()
        if not status['busy']:

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
            self._run_thread = threading.Thread(target=self._run)
            self._run_thread.start()
            rv = True

        return rv

    def _run(self):
        self.driver.terminate = False
        self.driver.run = True
        self.driver.effect()



    def input_supervisor(self):
        while True:
            user_input = input('Operation: ')

            if user_input == 'run':
                self.run()

            if user_input == 'pause':
                self.pause()

            elif user_input == 'resume':
                self.resume()

            elif user_input == 'terminate':
                self.terminate()

            elif user_input == 'status':
                self.status()

    def pause(self):
        self.driver.run = False
        return True

    def terminate(self):
        rv = False
        if self.driver:

            self.pause()
            self.driver.terminate=True
            rv  = True

        return rv




    def status(self):
        rv = self.driver.status()

        return rv


    def resume(self):
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
        self.driver.run = True

    def version(self):
        self.input_options = {'tab': 'manual', 'manualType': 'version-check'}
        self.driver = PlotDriver(self.input_options, self.filename)
        self.driver.effect()

if __name__ == '__main__':

    # pc = PlotControl(svg_string=svg_string, interactive=True)
    filename = '/Users/marcleonard/Projects/plotplanner/python/tree_test_text.svg'

    pc = PlotControl()
    pc.check_connection()
    # pc.setup_file(filename=filename)
# pc.version()
#     pc.run()
