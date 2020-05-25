import axios from 'axios'

let http = null // not possible to create a private property in JavaScript, so we move it outside of the class, so that it's only accessible within this module

class APIProvider {
  constructor ({ url }) {
    http = axios.create({
      baseURL: url + ':5001',
       headers: { 'Content-Type': 'application/json' }
    })
  }



  plot(svg) {

      return http.post('/plot', {
          'svg': `${svg.outerHTML}`
      })

  }

  terminate(){
      return http.post('/terminate', {})
    }

  status() {
       return http.post('/status', {})
    }

}

export default new APIProvider({
  url: 'http://127.0.0.1',  // We assume 'https://api.example.com/v1' is set as the env variable
})