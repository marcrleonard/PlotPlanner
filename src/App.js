import React, { Component } from 'react';
import LeftNav from './LeftNav';
import ImageCanvas from './ImageCanvas';
import RightNav from './RightNav';
// import logo from './logo.svg';
import './App.css';

class App extends Component {
  constructor(props) {
    super(props)
    this.state = {
      image: ''
      // image: '~/Users/marcleonard/Desktop/Poster_v3_A3.svg'
    }

    // why the hell is this needed??!?
    this.setImage = this.setImage.bind(this)

  }

  setImage(imagePath) {
    console.log("Settin g!! " + imagePath)
    this.setState({ image: imagePath })
  }

  render() {
    return (
      <div className="App">
        <header className="App-header">

        </header>
        <section className='window'>
          <LeftNav setImage={this.setImage} />
          <ImageCanvas svgImage={this.state.image} />
          <RightNav />
        </section>

        <footer>

        </footer>
      </div>
    );
  }
}

// local system
// desired state configuration 
// notepad++
// create image from powershell

export default App;
