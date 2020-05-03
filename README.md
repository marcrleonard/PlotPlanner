What is it?
-------

This is a fork of a few existing projects to create a better interface to work with pen plotters. The idea is to have both a GUI, and a command line interface. I am trying to circumvent Inkscape, and create a simple way to use a pen plotter with SVGs.

What's it made of?
--------

This project is broken into two parts:

1. A front end interface made in React. The main features are:
    - Loaded an SVG
    - Send it to be plotted (either locally, or through the network)
    - Show meaningful plot progress

2. Interface to the backend via http (Python Flask)    

3. `PlotControl` module backend. This is a fork/overhauled version of iDraw inkscape extension.
    - Provide a simpler interface to change settings. Currently, it relies on argparse. I've obscured this so now you can use a dictionary.
    - Allow it to be used as a module. I've taken inspiration from how Axidraw has written their module.  
    

Where is it now?
------

*Front end:*

- The front end can load an SVG and display it
- It can plot the loaded SVG
- Pause, Resume, and Terminate actions work

*Back end:*

- The backend has been cleaned of python2. 
- It has been 'modulized'. So you can call the python module directly via the rest api or as a class
- I've replaced the 'argparse' mess. Now you can give it a dictionary of settings, and it will set it's own custom `option` class


Todo:
=======
- Add full fledged CLI
- Add a way to replace text with hershey text
- Remove all unnecessary files. The python folder is basically a clone of the inkscape extensions folder. 
- Test all the settings
- Create a better validator for the settings.
- In the FE - add multiple passes, hooks, and other handy actions.


