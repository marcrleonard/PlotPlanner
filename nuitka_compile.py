import os
import sys

main_file = 'PlotPlanner.py'
base_cmd = f'{sys.executable} -m nuitka --standalone --plugin-enable=numpy {main_file}'





os.system(base_cmd)
