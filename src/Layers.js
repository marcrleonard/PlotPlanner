import React, { Component } from 'react';

class Layers extends Component {
    constructor(props) {
        super(props)
        this.state = {
            layers: []
        }

    }

    componentDidMount() {
        console.log(this.props.setImage)
    }

    render() {
        return (
            <div>

            </div>
        );
    }
}

export default Layers;