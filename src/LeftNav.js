import Layers from './Layers';
import ImportImage from './ImportImage';
import React, { Component } from 'react';


class LeftNav extends Component {
    constructor(props) {
        super(props)

    }
    render() {
        return (
            <div className='leftNav' >
                <div className='navButton'>
                    <ImportImage setImage={this.props.setImage} name='Import' icon=''></ImportImage>
                    <Layers setImage={this.props.setImage} name='Import' icon=''></Layers>
                </div>
            </div>

        );
    }
}

export default LeftNav;