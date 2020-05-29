import sys
import time
import io
from lxml import etree

sys.path.append('.')
from python.plotcontrol.plotdriver import PlotDriver
from python.svg_sort_interface import main as optimize_main


# e = WCB(input_options, filename = '/Users/marcleonard/Desktop/Poster_v3_A3.ai.svg')
# e = WCB(input_options, filename = '/Users/marcleonard/Projects/plotplanner/python/circle.svg')

# filename = '/Users/marcleonard/Projects/plotplanner/python/tree_test.svg'
# filename = '/Users/marcleonard/Projects/plotplanner/python/tree_inkscape_text.svg'


import threading


class PlotControl(object):
    def __init__(self, interactive=False):

        self.driver = PlotDriver()

        # self._svg_string = None
        self.filename = None

        self.interactive = interactive


    @property
    def svg_string(self):
        svg= ''
        with open(self.filename, 'r') as f:
            svg = f.read()

        return svg

    def flatten_transformations(self, svg_str=None):
        from python.applytransforms import applytransforms

        ss = applytransforms.ApplyTransform(svg_str)
        ss.effect()
        # print(ss.document)
        # print(ss.original_document)
        # print(ss)
        # from lxml import etree
        # print(etree.tostring(ss.original_document.getroot(), pretty_print=True).decode())
        # print(etree.tostring(ss.document.getroot(), pretty_print=True).decode())

        return ss.output_string

    def optimize(self, svg_str=None, incoming_args=None):

        if not svg_str:
            svg_str = self.svg_string

        svg_str = self.flatten_transformations(svg_str)


        args = {
                 '--dim': incoming_args.get('paperSize', 'A3'),
                 '--no-adjust': not incoming_args.get('centerPaths', True),
                 '--no-sort': False,
                 '--no-split': False,
                 '--pad': incoming_args.get('padding', '0'), #str?
                 '--pad-abs': True,
                 '--pen-moves': False,
                 '--repeat': False,
                 '--rnd': False,
                 '--split-all': False,
                 '--sw': '1.0',
                'preserve_orientation': incoming_args.get('preserverOrientation', 'True'),
                 '<in>': svg_str,
                 '<out>': 'dummy.svg'
        }


        rv = optimize_main(args, return_string=False)

        return rv



    def set_options(self, options):
        self.driver.set_options(options)

    def run(self, filename=None, svg_string=None):
        svg_document = None
        if filename:
            try:
                with open(filename, 'r') as stream:
                    p = etree.XMLParser(huge_tree=True)
                    svg_document = etree.parse(stream, parser=p)

            except Exception:
                print("Unable to open specified file: %s" % filename)
                sys.exit()

        # if svg_string:
        #     f = io.StringIO(svg_string)
        #     p = etree.XMLParser(huge_tree=True)
        #     svg_document = etree.parse(f, parser=p)

        self.filename = filename
        # self.svg_string = svg_string


        if svg_string:
            self.driver.svg_string = svg_string
        elif filename:
            self.driver.filename = self.filename

        else:
            print('No input provided.')
            return False

        rv = False

        status = self.connection()
        if not status['busy']:

            input_options = {
                # "tab": "timing",
                "tab": "splash",
                "penUpPosition": 10, # lower is higher?
                # "penUpPosition": 20, # lower is higher?
                "penDownPosition": 50,  # this is the movement ACTUALLY drawing
                # "laserPower": 50,
                # "setupType": 'align-mode',
                "penDownSpeed": 20,  # this is the movement when NOT drawing
                "rapidSpeed": 70,
                # "rapidSpeed": 50,
                "ServoUpSpeed": 40,
                "penUpDelay": 0,
                "ServoDownSpeed": 40,
                "penDownDelay": 0,
                "autoRotate": True,
                "constSpeed": False,
                # "report_time": True,
                "resolution": 1,
                "smoothness": 10,
                # "cornering": 10,
                "cornering": 20,
                "manualType": 'none',
                "WalkDistance": 1,
                "resumeType": 'ResumeNow',
                "layernumber": 1,

            }
            self.set_options(input_options)
            self._run_thread = threading.Thread(target=self._run, args=(svg_document,))
            self._run_thread.start()
            rv = True

        if self.interactive:
            self.input_supervisor()


        return rv

    def _run(self, document=None):
        self.driver.terminate = False
        self.driver.run = True
        self.driver.effect(document)

        self.complete_run()

    def complete_run(self):
        # This function will 'clear out' everything.
        self.driver.current_path = None
        self.driver.completed_paths = []


    def input_supervisor(self):
        while True:
            user_input = input('Operation: ')

            if user_input == 'run':
                self.run()

            elif user_input == 'pause':
                self.pause()

            elif user_input == 'resume':
                self.resume()

            elif user_input == 'terminate':
                self.terminate()

            elif user_input == 'status':
                self.connection()

    def pause(self):
        self.driver.run = False
        return True

    def terminate(self):
        rv = False
        if self.driver:

            self.pause()
            self.driver.terminate=True
            self.driver.sendDisableMotors()
            rv  = True
            self.complete_run()

        return rv




    def status(self):
        rv = self.driver.plot_status()

        return rv

    def connection(self):
        rv = self.driver.connection()

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
    filename = '/Users/marcleonard/Projects/plotplanner/svgs/tree.svg'
    # filename = '/Users/marcleonard/Projects/plotplanner/python/tree_test_text.svg'

    pc = PlotControl()
    pc.filename = filename

    # pc.flatten_transformations()

    pc.optimize()
    # pc.check_connection()
    # pc.setup_file(filename=filename)
    # pc.version()
    pc.run(filename=filename)
