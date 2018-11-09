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
    "penDownSpeed": 40,  # this is the movement when NOT drawing
    "rapidSpeed": 50,
    "ServoUpSpeed": 40,
    "penUpDelay": 0,
    "ServoDownSpeed": 40,
    "penDownDelay": 0,
    "autoRotate": True,
    "constSpeed": False,
    "report_time": False,
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
e = WCB(input_options, filename = '/Users/marcleonard/Projects/plotplanner/python/tree.svg')
e.effect()


