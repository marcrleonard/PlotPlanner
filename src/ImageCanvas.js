import React, { Component } from 'react';
import Draggable, { DraggableCore } from 'react-draggable'; // Both at the same time
import SVG from 'react-inlinesvg';

class ImageCanvas extends Component {
    constructor(props) {
        super(props)
        this.state = {
            svgImage: '',
            imageWidth: '-',
            imageHeight: '-',
            imageLayers: 0,
            layerIds: []
        }

        this.loadLayer = this.loadLayer.bind(this);
        this.myOnLoadHandler = this.myOnLoadHandler.bind(this);
    }


    componentDidUpdate() {
        // this.setState({
        //     imageHeight: this.props.svgImage.height,
        //     imageWidth: this.props.svgImage.width
        // })

        // function waitForImageToLoad(imageElement) {
        //     return new Promise(resolve => { imageElement.onload = resolve })
        // }


        // waitForImageToLoad(this.refs.load_svg).then(() => {
        //     // Image have loaded.

        //     var object = this.refs.load_svg;

        //     let out = object.childNodes;
        //     console.log(out)
        //     console.log('Loaded lol')

        //     // console.log(svgDoc)

        // });


    }

    loadLayer(svg) {

        let supported_elements = ['path', 'circle', 'rect', 'line']

        let numLayers = 0;
        let layerIds = [];


        for (let ele of supported_elements) {

            let paths = svg.getElementsByTagName(ele)
            console.log(paths)
            for (let path of paths) {
                path.setAttribute("id", 'pp_layer_' + numLayers);

                // might need this?
                //  path.setAttribute("ref", 'pp_layer_' + numLayers);

                numLayers += 1
                layerIds.push(path.id)
            }



        }
        this.setState({
            imageLayers: numLayers,
            layerIds: layerIds
        })

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
            // svgImage: svg_ele,
            imageHeight: height,
            imageWidth: width
        })

        this.loadLayer(svg_ele);

    }



    render() {


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

                </div>
                <div class='underCanvas'>
                    <Draggable>
                        <div className='imageCanvas'>

                            <div ref='load_svg'>

                                {/* <Samy path={this.props.svgImage}>
                                <Proxy select="#Star" fill="red" />
                            </Samy> */}
                                <SVG
                                    ref='load_svg'
                                    src={this.props.svgImage}
                                    // preloader={<Loader />}
                                    wrapper={React.createFactory('div')}
                                    onLoad={() => { // (src) can actually go into this callback, which is handy.
                                        this.myOnLoadHandler();

                                    }}
                                    className='embeddedImage'
                                >
                                    {/* Here's some optional content for browsers that don't support XHR or inline
                                SVGs. You can use other React components here too. Here, I'll show you.
                                <img src={this.props.svgImage} /> */}
                                </SVG>

                                {/* <object className='embeddedImage' data={this.props.svgImage} type="image/svg+xml" ref='load_svg' /> */}

                            </div>



                        </div>
                    </Draggable>
                </div>



            </div >
        );
    }
}

export default ImageCanvas;