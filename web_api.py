import os
import sys
sys.path.append('.')
from flask import Flask, send_from_directory, request, jsonify
from flask_cors import CORS
from python.plotter import PlotControl


app = Flask(__name__, static_url_path='', static_folder='build')

cors = CORS(app)

pc = PlotControl(interactive=False)

# Serve React App
@app.route('/')
# @app.route('/<path:path>')
def serve(path=''):
    return send_from_directory('build','index.html')


@app.route('/ping')
def ping():
    return jsonify('pong')

@app.route('/check_plotter')
def check_plotter():
    rv = pc.check_connection()
    return jsonify(rv)

@app.route('/plot', methods=['POST'])
def plot():
    svg_str = (request.json.get('svg', None))
    rv  = pc.run(svg_string=svg_str)
    return jsonify(rv)

@app.route('/terminate', methods=['POST'])
def stop():
    rv = pc.terminate()
    return jsonify(rv)

@app.route('/pause', methods=['POST'])
def pause():
    rv = pc.pause()
    return jsonify(rv)


@app.route('/status', methods=['POST'])
def status():
    rv = pc.status()
    return jsonify(rv)


if __name__ == '__main__':
    app.run(use_reloader=False, port=5001, threaded=True)