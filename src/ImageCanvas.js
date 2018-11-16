import React, { Component } from 'react';
import Draggable, { DraggableCore } from 'react-draggable'; // Both at the same time
import SVG from 'react-inlinesvg';
import axios from 'axios';

class ImageCanvas extends Component {
    constructor(props) {
        super(props)
        this.state = {
            svgImage: '',
            imageWidth: '-',
            imageHeight: '-',
            imageLayers: 0,
            layerIds: [],
            plotting: true
        }


        this.myOnLoadHandler = this.myOnLoadHandler.bind(this);
    }


    componentDidMount() {

        this.timer = setInterval(() => this.plotStatus(), 2000);
    }

    componentWillUnmount() {
        this.timer = null; // here...
    }



    myOnLoadHandler() {
        let svgContainer = this.refs.load_svg
        let svg_ele = svgContainer.getElementsByTagName('svg')[0]

        let width = '-'
        let height = '-'

        if (svg_ele.hasAttribute('height')) {
            height = svg_ele.getAttribute("height")
        }
        if (svg_ele.hasAttribute('width')) {
            width = svg_ele.getAttribute("width")

        }

        this.setState({
            imageHeight: height,
            imageWidth: width
        })

        ///////////////////

        let supported_elements = ['path', 'circle', 'rect', 'line']

        let numLayers = 0;
        let layerIds = [];


        for (let ele of supported_elements) {

            let paths = svg_ele.getElementsByTagName(ele)
            for (let path of paths) {
                path.setAttribute("id", 'pp_layer_' + numLayers);

                // might need this?
                //  path.setAttribute("ref", 'pp_layer_' + numLayers);

                numLayers += 1
                layerIds.push(path.id)
            }



        }

        let location = document.getElementById('loaded_Svg')
        location.appendChild(svg_ele)
        // console.log(svg_ele)

        this.setState({
            imageLayers: numLayers,
            layerIds: layerIds,
            // svgImage: svg
        })

    }

    imageLoaded() {
        let rv = false
        if (this.state.svgImage) {
            rv = true
        }
        return rv
    }



    plotImage() {

        console.log('plot dat shiz!')
        let svg_ele = (document.getElementById('loaded_Svg')).firstChild
        // let svg_ele = (this.refs.load_svg).getElementsByTagName('svg')[0]
        console.log(svg_ele)




        axios.post('/plot', {
            'svg': `${svg_ele.outerHTML}`
        })
            .then((response) =>
                this.setState({
                    'plotting': response.data
                }
                )
            )


    }

    terminatePlot(yo) {
        axios.post('/terminate', {
        })
            .then((response) =>
                console.log(response.data)

            )

    }

    plotStatus(yo) {
        axios.post('/status', {
        })
            .then((response) =>
                this.setHighlight(response.data)
            )

    }

    setHighlight(data) {
        try {
            let ele = document.getElementById(data.current_path)
            ele.setAttribute("style", 'stroke-width:20px;');
        }
        catch (e) {
            console.log('error setting class')
            console.log(e)
        }

    }

    pausePlot(yo) {
        axios.post('/pause', {
        })
            .then((response) =>
                console.log(response.data)

            )

    }

    getSVG() {

        if (this.state.svgImage) {
            let svgContainer = this.refs.load_svg
            return svgContainer.getElementsByTagName('svg')[0]
        }
        else {
            return <svg width={617} height={316}>
                <g>
                    <rect x="400" y="40" width="100" height="200" fill="#4286f4" stroke="#f4f142" />
                    <circle cx="108" cy="108.5" r="100" fill="#0ff" stroke="#0ff" />
                    <circle cx="180" cy="209.5" r="100" fill="#ff0" stroke="#ff0" />
                    <circle cx="220" cy="109.5" r="100" fill="#f0f" stroke="#f0f" />
                </g>
            </svg>
        }
    }




    render() {

        if (!this.props.plotting) {
            console.log('status...')
            this.plotStatus()
        }


        return (
            <div className='canvasContainer'>
                <div className='canvasInfo'>
                    <div className='canvasSubInfo' >
                        Height: {this.state.imageHeight}
                    </div>
                    <div className='canvasSubInfo'>
                        Width: {this.state.imageWidth}
                    </div>
                    <div className='canvasSubInfo'>
                        Layers: {this.state.imageLayers}
                    </div>
                    <div className='navButton'>
                        <button onClick={this.plotImage.bind(this)} name='Plot!' icon=''> Plot! </button>
                        <button onClick={this.pausePlot.bind(this)} name='Pause!' icon=''> Pause! </button>
                        <button onClick={this.terminatePlot.bind(this)} name='Terminate!' icon=''> Termiante! </button>


                    </div>


                </div>
                <div className='underCanvas'>

                    <div hidden ref='load_svg'>
                        <SVG
                            ref='load_svg_svg'
                            src={this.props.svgImage}
                            // preloader={<Loader />}
                            wrapper={React.createFactory('div')}
                            onLoad={() => { // (src) can actually go into this callback, which is handy.
                                this.myOnLoadHandler();
                            }}
                            className='embeddedImage'
                        >
                        </SVG>






                    </div>
                    <Draggable>
                        <div className='imageCanvas' id='loaded_Svg'>

                        </div>
                    </Draggable>
                </div>



            </div >
        );
    }
}

export default ImageCanvas;