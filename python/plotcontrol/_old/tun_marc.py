from inkex import Effect


# eee = Effect()



import idraw
import sys
import xml.etree.ElementTree as ET

from lxml import etree



sys.argv[-1] = '/Users/marcleonard/Desktop/Poster_v3_A3_Landscape_trimmed.svg'

yoyo = idraw.WCB()

file = '/Users/marcleonard/Desktop/Poster_v3_A3_Landscape_trimmed.svg'


tree = ET.parse(file)
root = tree.getroot()
print(root.tag)
yoyo.svg_file = root
yoyo.effect()
