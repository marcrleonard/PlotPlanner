import React, { Component } from 'react';
import Draggable, { DraggableCore } from 'react-draggable'; // Both at the same time

class ImageCanvas extends Component {
    constructor(props) {
        super(props)
        this.state = {
            svgImage: '',
            imageWidth: '-',
            imageHeight: '-'
        }
    }


    componentDidUpdate() {
        // this.setState({
        //     imageHeight: this.props.svgImage.height,
        //     imageWidth: this.props.svgImage.width
        // })
        function waitForImageToLoad(imageElement) {
            return new Promise(resolve => { imageElement.onload = resolve })
        }


        var myImage = document.getElementById('myImage');

        // this.setState({ svgImage: this.props.svgImage })

        this.refs.load_svg.data = this.state.svgImage

        waitForImageToLoad(this.refs.load_svg).then(() => {
            // Image have loaded.
            console.log('Loaded lol')
            var object = this.refs.load_svg;

            var svgDoc = object.firstElementChild;


            console.log(svgDoc)

        });








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

                </div>
                <Draggable>
                    <div className='imageCanvas'>
                        {/* <img src={this.props.svgImage}></img> */}

                        <div>
                            <object className='embeddedImage' data={this.state.svgImage} type="image/svg+xml" ref='load_svg'>
                                <svg></svg>
                            </object>
                        </div>



                    </div>
                </Draggable>

            </div >
        );
    }
}

export default ImageCanvas;