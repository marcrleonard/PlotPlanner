##PlotPlanner

####What is it?

This is a fork off a few existing projects the create a better interface to work with a pen plotter. It has a GUI, and a python interface. In a lot of ways, I am trying to create a simple, more modern version of how Inkscape is used to plot SVGs

####What's it made of?

This project is broken into two parts:

1. A front end interface made in React. This will display a loaded SVG, and send it as a plotting job to the backend. Eventually this will allow you to add multiple passes, hooks, and other handy actions.
2. The Python backend. This is a fork/overhauled of iDraw inkscape extension. There are a few reasons this is necessary...
    - Remove Python 2 cruft
    - Provide a simpler interface to change settings. Currently, it relies on argparse. I've obscured this so now you can use a dictionary.
    - Allow it to be used as a module. I've taken inspiration from how Axidraw has written their module.  
    

####Where is it now?

The front end and back end are working independently. 

*Front end:*

- The front end can load an SVG and display it

*Back end:*

- The backend has been cleaned of python2. 
- It has been 'modulized'. So you can call the python module directly
- I've replaced the 'argparse' mess. Now you can give it a dictionary of settings.


####Todo:
- Remove all unnecessary files. The python folder is basically a clone of the inkscape extensions folder. 
- Test all the settings
- Create a better validator for the settings.


