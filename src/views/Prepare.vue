<template>

    <div class="column">
        <div class="left">
            <div class="tabs">
                <div id="overview-tab" :class="getTabClass('overview-tab')"  v-on:click="activateTab('overview-tab')">Overview</div>
                <div id="optimize-tab" :class="getTabClass('optimize-tab')" v-on:click="activateTab('optimize-tab')">Optimize</div>
            </div>

            <div class="svg-info" v-if="activeTab === 'overview-tab'">
                <div class="section-heading">
                    Document
                    <div class="info-container">
                        <div class="info-key">
                            <div>Width:</div>
                            <div>Height:</div>
                            <div>Paths:</div>
                        </div>
                        <div class="info-value">
                            <div>{{this.$store.state.globalSvgWidth}}</div>
                            <div>{{this.$store.state.globalSvgHeight}}</div>
                            <div>{{this.$store.state.globalSvgNumPaths}}</div>
                        </div>
                    </div>
                </div>

                <div class="section-heading">
                    Plotter
                    <div class="info-container">
                        <div class="info-key">
                            <div>Connected:</div>
                            <div>Busy:</div>
                        </div>
                        <div class="info-value">
                            <div>{{this.$store.state.plotterConnected}}</div>
                            <div>{{this.$store.state.plotterBusy}}</div>
                        </div>
                    </div>


                </div>

                <div class="section-heading">
                    Selected Paths
                    <div class="info-container">
                        <div class="info-key">
                            <div>Paths Selected:</div>
                        </div>
                        <div class="info-value">
                            <div>{{pathValue}}</div>
                        </div>
                    </div>


                </div>


                <div class="plot-button" v-on:click="plotSvg"> PLOT</div>
            </div>


            <!--        OPTIMIZE-->
            <div v-else  class="svg-info">
                <div class="section-heading">
                    <div class="info-container">
                        <div class="optimize-key">
                            <div>Paper Size:</div>
                            <br>
                            <div>Center Paths:</div>
                            <br>
                            <div>Padding:</div>
                            <br>
                            <div>Preserve Orientation:</div>
                        </div>
                        <div class="optimize-value">
                            <select v-model="optimizeSettings.paperSize" name="paper-size" id="paper-size">
                              <option value="A3">A3 (420mm x 297mm)</option>
                              <option value="A4">A4 (297mm x 210mm)</option>
                            </select>
                            <br>
                            <br>
                            <div><input type=checkbox v-model="optimizeSettings.centerPaths" v-bind:checked=optimizeSettings.centerPaths name=centerPaths/> </div>
                            <br>
                            <br>
                            <div><input type="number" v-model="optimizeSettings.padding" :disabled="optimizeSettings.centerPaths ==! true" name="tentacles" min="0" max="2000"></div>
                            <br>
                            <br>
                            <div><input type=checkbox v-model="optimizeSettings.preserverOrientation" v-bind:checked=optimizeSettings.preserverOrientation name=cheese/> </div>

                        </div>
                    </div>
                </div>
                <div class="plot-button" v-if="optimized" v-on:click="revertOptimizedSvg"> REVERT</div>
                <div class="plot-button" v-else v-on:click="optimizeSvg"> OPTIMIZE</div>

            </div>
            <!--        OPTIMIZE-->

        </div>

        <div class="right">
              <div class="svg-title">{{plotShowing}}</div>
                <div class="svg-container" id="svgContainer" v-html=svgToShow>

        </div>

        </div>
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

    .active-tab {
        margin:auto;
        width: 50%;
        float: left;
        background: #DBDBDB;
    }

    .tabs {
        cursor: pointer;
        font-size: 32px;
        font-weight: bold;
    }

    .inactive-tab{
        /*color: #FCFCFC;;*/
        background: #FCFCFC;
        border-top: 2px solid #DBDBDB;
        border-right: 2px solid #DBDBDB;
        margin-bottom: -2px;
        float: right;
        width: 49%;
    }

    .section-heading {
        padding: 20px 20px 10px 20px;
        font-size: 28px;
        font-weight: bold;
        /*color: #FCFCFC;*/
    }

    .svg-info {
        text-align: left;
        color: #454545;
        font-size: 18px;
        background-color: #DBDBDB;
        margin-top:39px;
        margin-bottom: 20px;
        /*padding-bottom: 20px;*/
    }
    .svg-title {
        text-align: left;
        color: #454545;
        font-size: 24px;
        margin-bottom: 5px;

    }
    .info-container {
        display: flex;
        display: -webkit-flex; /* Safari */

        font-size: 22px;
        font-weight: bold;

    }

    .info-key {
        width: 50%;
        padding-left: 10px;
        flex: 1;
        -ms-flex: 1;
        -webkit-flex: 1;
        text-align: left;
        font-weight: lighter;

    }



    .info-value {
        padding-left: 10px;
        width: 50%;
        text-align: left;
        flex: 2;
        -ms-flex: 2;
        -webkit-flex: 2;

        font-weight: lighter;

    }

        .optimize-key {
        padding-left: 10px;
        flex: 1;
        -ms-flex: 1;
        -webkit-flex: 1;
        text-align: left;
        font-weight: lighter;

    }
         .optimize-value {
        padding-left: 10px;
        /*width: 50%;*/
        text-align: left;
        flex: 2;
        -ms-flex: 2;
        -webkit-flex: 2;

        font-weight: lighter;

    }


    path {
        fill: none;
        stroke: black;
        pointer-events: all;
    }

    /*path{*/
    /*    pointer-events:all;*/
    /*    stroke: #DBDBDB;*/
    /*}*/

    path:hover {
        stroke: black;
        stroke-width: 4;
    }


    .column {
        display: -webkit-flex; /* Safari */

        display: flex; /* Standard syntax */
    }

    .left {


        width: 100%;

        margin-right: 15px;

        -webkit-flex: 3; /* Safari */
        -ms-flex: 3; /* IE 10 */
        flex: 3; /* Standard syntax */

    }

    .right {
        flex: 8;
        -ms-flex: 8;
        -webkit-flex: 8;

        height: 100%;
    }

</style>

<script>
    import Vue from 'vue'

    new Vue({
        created: function () {
            console.log('about created')
            // console.log(this.$store.state)
            // document.getElementById("svgContainer").appendChild(this.$store.state.globalSvg);
        },


    })

    export default {
        name: 'Prepare',
        data() {
            return {
                optimized: false,
                optimizeSettings: {
                    padding:0,
                    paperSize:'A3',
                    centerPaths:false,
                    preserverOrientation:false
                },
                activeTab: 'overview-tab'
            }
        },

        mounted: function () {
            // window.setInterval(() => {
            //
            //     let resp = this.$api.connection()
            //     resp.then((response) =>
            //
            //         this.$store.commit('setPlotterStatus', response.data)
            //     )
            //
            //
            // }, 4000)


            // window.setInterval(() => {
            //     console.log('getting status')
            // }, 2000)
        },

        methods: {

            activateTab: function(tab){
                this.activeTab = tab
            },

            plotSvg: function () {
                console.log('sending plot message')


                let resp = this.$api.plot(this.$store.state.globalSvg)
                resp.then((response) =>

                    this.redirectToPlot(response.data)
                )
            },

            optimizeSvg: function () {
                console.log('sending optimize message')

                let resp = this.$api.optimize(this.$store.state.globalSvg, this.optimizeSettings)
                resp.then((response) =>
                        this.loadOptimizedSvg(response.data)
                    // console.log(response.data)
                )
            },

            loadOptimizedSvg: function (svg_str) {
                var parser = new DOMParser();
                var doc = parser.parseFromString(svg_str, "image/svg+xml");
                console.log(doc.documentElement)
                this.$store.commit('setOptimizedSvg', doc.documentElement)
                this.$store.commit('setSvg', doc.documentElement)
                this.optimized = true
            },

            selectPath: function($event){
                console.log($event)
                // this.$store.commit('appendSelectedPath' ,'')
            },

            revertOptimizedSvg: function () {
                this.$store.commit('setSvg', this.$store.state.originalSvg)
                this.optimized = false
            },

            redirectToPlot: function (redirect) {
                if (redirect === true) {
                    this.$router.push({path: '/plot'})
                }
            },

            redirect: function () {
                console.log('rerouting')
                this.$router.push({path: '/'})
            },

            getTabClass: function(tab){
                if ( tab === this.activeTab){
                    return 'active-tab'
                }
                else {
                    return 'inactive-tab'
                }
        },


        },

        computed: {


            pathValue: function(){
                if (this.$store.state.globalPathsSelected.length > 0){
                    return this.$store.state.globalPathsSelected.length
                }
                else {
                    return 'All'
                }
            },

            plotShowing: function(){
                let rv =  'Original SVG'

                if (this.optimized) {
                    rv = 'Optimized SVG'
                }

                return rv
            },

            svgToShow: function () {

                let rv_svg = this.$store.state.globalSvg


                if (rv_svg === null) {
                    this.redirect()
                    return null
                }
                // rv_svg.removeAttribute("width")
                // rv_svg.removeAttribute("height")

                return this.$store.state.globalSvg.outerHTML
            }
        }
    }

</script>
