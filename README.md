![](./demo.gif)

What is it?
-------
This is a web interface to load SVGs and plot them. It features a MUCH better interface than what is currently out there (**cough** inkscape **cough**).
It includes a few other pieces of tooling to make a great experice:
- svg-sort (https://github.com/inconvergent/svgsort)
- applytransforms (https://github.com/Klowner/inkscape-applytransforms)
- axidraw driver (https://github.com/evil-mad/axidraw/tree/master/inkscape%20driver)

What plotters does it support?
-----------------------------
Good question. Not entirely sure ;-)

I use it on a chinese axidraw knock off. Presumably it also works on the axidraw. However... I think the driver it's using
is an old version... so that needs to be updated. Though this is a tricky thing to do, as I have hacked the inkscape file. It would be best to use the `pip install` version of the driver. 

What's it made of?
--------

This project is broken into two parts:

1. A front end interface made in Vue. The main features are:
    - Loaded an SVG
    - Optimize the SVG for efficient plotting
    - Properly center/pad the SVG
    - Send it to be plotted (either locally, or through the network)
    - Show meaningful plot progress (with UI representation)

2. Interface to the backend via http (Python Flask)    


Todos:
------
- Better styling and font hierarchy (ESPECIALLY on the Prepare Page)
- Migrate plot driver to the axidraw `pip` version
- 'Download' button of optimized SVG
- Add plotter settings page (and test all the settings)
- Add multiple passes (groups... maybe abide by the <g> tags?)
- Plot one 'selected' path (partial implemented. Not working) 
- Add a way to replace text with hershey text
- Remove all unnecessary files. The python folder is basically a clone of the inkscape extensions folder. 


