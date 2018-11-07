import React, { Component } from 'react';

class ImageCanvas extends Component {
    constructor(props) {
        super(props)
        this.state = {

        }
    }
    render() {
        return (
            <div className='imageCanvas'>

                {/* <img src={this.props.svgImage}></img> */}
                <object className='embeddedImage' data={this.props.svgImage} type="image/svg+xml" id='load_svg'>
                    <svg></svg>
                </object>

            </div>
        );
    }
}

export default ImageCanvas;