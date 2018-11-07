import React, { Component } from 'react';

class ImportImage extends Component {
    constructor(props) {
        super(props);
        this.state = { image: '' }
    }





    onChangeFile(event) {
        event.stopPropagation();
        event.preventDefault();
        if (event.target.files) {
            var file = event.target.files[0];

            var tmppath = URL.createObjectURL(event.target.files[0]);
            console.log(tmppath)
            // var file = event.target.files[0];
            console.log(file);
            console.log(file.name);
            // this.setState({ image: tmppath }); /// if you want to upload latter

            this.props.setImage(tmppath)
        }

    }


    render() {
        return (
            <div className='heroButton'>
                <div
                    label="Open File"
                    primary={false}
                    onClick={() => { this.upload.click() }}>
                    {this.props.name}
                    <input id="myInput"
                        type="file"
                        ref={(ref) => this.upload = ref}
                        style={{ display: 'none' }}
                        onChange={this.onChangeFile.bind(this)}
                    />
                </div>
            </div>
        );
    }
}

export default ImportImage;