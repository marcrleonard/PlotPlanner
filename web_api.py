import os
import sys
sys.path.append('.')
from flask import Flask, send_from_directory, request, jsonify

from python.plotter import PlotControl

BUILD_LOCATION = 'build'

app = Flask(__name__, static_url_path='', static_folder='build')

pc = PlotControl(interactive=False)

# Serve React App
@app.route('/')
# @app.route('/<path:path>')
def serve(path=''):
    return send_from_directory('build','index.html')


@app.route('/ping')
def ping():
    return jsonify('pong')

@app.route('/plot', methods=['POST'])
def plot():
    svg_str = (request.json.get('svg', None))
    pc.setup_file(svg_string=svg_str)
    pc.run()
    return jsonify(True)

@app.route('/terminate', methods=['POST'])
def stop():
    rv = pc.terminate()
    return jsonify(rv)


@app.route('/pause', methods=['POST'])
def pause():
    rv = pc.pause()
    return jsonify(rv)


if __name__ == '__main__':
    app.run(use_reloader=True, port=5000, threaded=True)