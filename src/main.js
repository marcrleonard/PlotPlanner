import Vue from 'vue'
import App from './App.vue'
import VueRouter from 'vue-router'
import Vuex from 'vuex'
import api from './api.js'

Vue.use(Vuex);

Vue.config.productionTip = false;
Vue.use(VueRouter);

Vue.$api = api

Object.defineProperty(Vue.prototype, '$api', {
  get () {
    return api
  }
})

const store = new Vuex.Store({
  state: {
    globalSvg   : null, // this is the SVG that is sent to plot.
    originalSvg :null, // this is the SVG that is sent originally uploaded.
    optimizedSvf   : null, // this is the SVG that is the optimized SVG.
    globalPathsSelected: [], // Paths selected

    globalSvgWidth: 0,
    globalSvgHeight: 0,
    globalSvgNumPaths: 0, // THIS IS 1 BASED. NOT ZERO BASED

    plotterConnected:false,
    plotterBusy: false,

    pathsPlotted :0

  },

    getters : {
      globalSvgIncomplete: function(state)  {
          let s = state.globalSvg

           let supported_elements = ['path', 'circle', 'rect', 'line']

            // THIS IS 1 BASED. NOT ZERO BASED.

            for (let ele of supported_elements) {

                let paths = s.getElementsByTagName(ele)

                for (let p of paths){

                    p.setAttribute('stroke', 'black')
                    p.setAttribute("stroke-opacity", '.2');


                }


            }

          return s

      }

    },
  mutations: {
      setPlotterStatus(state, status){
          // console.log(state, status)
        state.plotterConnected =  status.connected
        state.plotterBusy = status.busy
      },

      setPathsPlotted(state, numPaths){
          state.pathsPlotted = numPaths
      },

      setOriginalSvg(state, svg){
          state.originalSvg = svg
          // this.commit.setSvg(state, svg)
      },

      setOptimizedSvg(state, svg) {
        state.optimizedSvf = svg
        // this.commit.setSvg(state, svg)
      },

      // revertOptimizedSvg(state) {
      //     // this.commit.setSvg(state, state.originalSvg)
      // },

      appendSelectedPath(state, path ) {
          state.globalPathsSelected.push(path)
      },
      clearSelectedPaths(state){
          state.globalPathsSelected = []
      },

      setSvg(state, svg){

        if (svg.hasAttribute('height')) {
            state.globalSvgHeight = svg.getAttribute("height")
        }
        if (svg.hasAttribute('width')) {
            state.globalSvgWidth = svg.getAttribute("width")
        }


        let supported_elements = ['path', 'circle', 'rect', 'line']

        // THIS IS 1 BASED. NOT ZERO BASED.
        let num_paths = 1

        for (let ele of supported_elements) {

            let paths = svg.getElementsByTagName(ele)

            for (let p of paths){

                 p.setAttribute("id", 'pp_layer_' + num_paths);

                p.setAttribute('stroke', 'black')
                // path.setAttribute('stroke', 'grey')
                // p.setAttribute("stroke-opacity", '.2');

                num_paths +=1
            }


        }


        state.globalSvgNumPaths = num_paths


      state.globalSvg = svg
    }
  }
})


new Vue({
  store,
  render: h => h(App),
}).$mount('#app');
