#!/usr/bin/env python2
#
# License: GPL2
# Copyright Mark "Klowner" Riedesel
# https://github.com/Klowner/inkscape-applytransforms
#

from python.plotcontrol import inkex
from python.plotcontrol import cubicsuperpath
import math
import io
from lxml import etree
import copy

from python.plotcontrol.hershey import simplestyle
from python.plotcontrol.simpletransform import composeTransform, fuseTransform, parseTransform, applyTransformToPath, applyTransformToPoint, formatTransform

class ApplyTransform(inkex.Effect):
	def __init__(self, svg_str):
		inkex.Effect.__init__(self)
		
		self.document = None
		self.original_document = None
		self.svg_str = svg_str

	def effect(self):



		f = io.StringIO(self.svg_str)

		p = etree.XMLParser(huge_tree=True)
		self.document = etree.parse(f, parser=p)
		self.original_document = copy.deepcopy(self.document)

		self.recursiveFuseTransform(self.document.getroot(), parseTransform(None))

	@property
	def output_string(self):
		return etree.tostring(self.document.getroot(), pretty_print=False).decode()



	@staticmethod
	def objectToPath(node):
		if node.tag == inkex.addNS('g', 'svg'):
			return node

		if node.tag == inkex.addNS('path', 'svg') or node.tag == 'path':
			for attName in node.attrib.keys():
				if ("sodipodi" in attName) or ("inkscape" in attName):
					del node.attrib[attName]
			return node

		return node

	def scaleStrokeWidth(self, node, transf):
		if 'style' in node.attrib:
			style = node.attrib.get('style')
			style = simplestyle.parseStyle(style)
			update = False

			if 'stroke-width' in style:
				try:
					stroke_width = self.unittouu(style.get('stroke-width').strip())
					# pixelsnap ext assumes scaling is similar in x and y
					# and uses the x scale...
					# let's try to be a bit smarter
					# the least terrible option is using the geometric mean
					stroke_width *= math.sqrt(abs(transf[0][0] * transf[1][1]))
					style['stroke-width'] = str(stroke_width)
					update = True
				except AttributeError:
					pass

			if update:
				style = simplestyle.formatStyle(style)
				node.attrib['style'] = style

	def recursiveFuseTransform(self, node, transf=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]):
		transf = composeTransform(transf, parseTransform(node.get("transform", None)))

		if 'transform' in node.attrib:
			del node.attrib['transform']

		node = ApplyTransform.objectToPath(node)

		if 'd' in node.attrib:
			d = node.get('d')
			p = cubicsuperpath.parsePath(d)
			applyTransformToPath(transf, p)
			node.set('d', cubicsuperpath.formatPath(p))

			self.scaleStrokeWidth(node, transf)

		elif node.tag in [inkex.addNS('polygon', 'svg'),
						  inkex.addNS('polyline', 'svg')]:
			points = node.get('points')
			points = points.strip().split(' ')
			for k,p in enumerate(points):
				if ',' in p:
					p = p.split(',')
					p = [float(p[0]),float(p[1])]
					applyTransformToPoint(transf, p)
					p = [str(p[0]),str(p[1])]
					p = ','.join(p)
					points[k] = p
			points = ' '.join(points)
			node.set('points', points)

			self.scaleStrokeWidth(node, transf)

		elif node.tag in [inkex.addNS('rect', 'svg'),
						  inkex.addNS('text', 'svg'),
						  inkex.addNS('image', 'svg'),
						  inkex.addNS('use', 'svg'),
						  inkex.addNS('circle', 'svg')]:
			node.set('transform', formatTransform(transf))

		else:
			# e.g. <g style="...">
			self.scaleStrokeWidth(node, transf)

		for child in node.getchildren():
			self.recursiveFuseTransform(child, transf)


if __name__ == '__main__':
	e = ApplyTransform()
	e.affect()
