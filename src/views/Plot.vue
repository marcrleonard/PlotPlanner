<template>

    <div>
        <div class="button-container">

            <div class="info-panel">
                <div>
                    {{this.$store.state.pathsPlotted}} of {{this.$store.state.globalSvgNumPaths}} paths plotted
                </div>
            </div>
             <div class="button-left pause-button" v-on:click="pauseResumePlot"> {{pauseResumeButtonName}} </div>
            <div class="button-right terminate-button" v-on:click="terminatePlot"> TERMINATE </div>

        </div>

        <div class="svg-container" id="svgContainer" v-html=svgInProgress></div>

    </div>

</template>

<style scoped>

        #svgContainer >>> svg {
        width: 100%;
        height: auto;
    }

    #svgContainer >>> path {
        fill: none;
        stroke: black;

    }

    #svgContainer >>> path:hover {
        stroke: black;
        stroke-width: 4;
    }

    .svg-container {
        border: 6px solid #DBDBDB;
        background-color: white;
    }


    .button-container {
        display: flex;
        display: -webkit-flex; /* Safari */

        font-size: 22px;
        font-weight: bold;
    }
    .button-left {
        width:100%;
        margin: 20px;
        flex:1;
       -ms-flex:1;
        -webkit-flex: 1;
    }
     .button-right {
         margin: 20px;
        width:100%;
        flex:1;
    -ms-flex:1;
    -webkit-flex: 1;


    }
    .info-panel{
          margin: 20px;
        width:100%;
             flex:1;
    -ms-flex:1;
    -webkit-flex: 1;
    }

</style>

<script>


    export default {
        name: 'Plot',
        data() {
        return {
            isPaused:false
        }
      },

        mounted: function () {
         window.setInterval(() => {

             let resp = this.$api.status()
             resp.then((response) =>
                 this.setHighlight(response.data)

                 // this.$store.commit('setPlotterStatus', response.data)

            )


         }, 4000)


        // window.setInterval(() => {
        //     console.log('getting status')
        // }, 2000)
    },

        methods: {

            pauseResumePlot: function(){
                if (this.isPaused === true) {
                    this.resumePlot()
                }
                else {
                    this.pausePlot()
                }
            },

            resumePlot: function(){
                this.isPaused = false
                this.$api.resume()
            },

            pausePlot: function(){
                this.isPaused = true
                this.$api.pause()
            },
            terminatePlot: function(){
                this.$api.terminate()
                this.isPaused = false
                this.$store.commit('setPathsPlotted', 0)

            },

            setHighlight: function (data) {
                // this incoming data is DIRECTLY from the /plot_status api call
                try {
                    let ele = document.getElementById(data.current_path)
                    if (ele) {
                        ele.setAttribute("stroke", 'green');
                        ele.setAttribute("stroke-width", '4');
                        ele.setAttribute("stroke-opacity", '1');
                    }
                    console.log('set current path.')
                    // ele.setAttribute("style", 'stroke-style:#FF0000;');

                    // ele.setAttribute("style", 'stroke-width:20px;');
                } catch (e) {
                    console.log('error setting class')
                    console.log(e)
                }

                console.log('setting paths..')

                for (let path_id of data.completed_paths) {
                    let ele = document.getElementById(path_id)
                    ele.setAttribute("stroke", 'black');
                    ele.setAttribute("stroke-width", '1');
                    ele.setAttribute("stroke-opacity", '1');
                }
                console.log('done setting paths')

                if (data.completed_paths.length > 0) {
                    this.$store.commit('setPathsPlotted', data.completed_paths.length)
                }

            }
        },
        computed: {

            pauseResumeButtonName : function(){
                let btnName = 'PAUSE'
                if (this.isPaused === true) {
                    btnName = 'RESUME'
                }

                return btnName
            },

            svgInProgress : function() {
                let svg = this.$store.getters.globalSvgIncomplete.outerHTML

                return svg
            }
        }
    }

</script>
