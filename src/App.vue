<template>
    <div class="app-bg" id="app">

        <!--  <a href="/#/home"><img  alt="Vue logo" src="./assets/Logo_ML.png"></a>-->

        <div v-show="showModal" class="full-screen">
            <div class="modal-container"> </div>
            <div class="bg-overlay"></div>


        </div>

        <div class="nav-container">
            <h1 class="logo">PLOT PLANNER</h1>
            <div class="navmenu">
                <ul>
                    <li class="nav-item">
                        <router-link to="/">LOAD</router-link>
                    </li>
                    <li :class="canNavigate">
                        <router-link to="/prepare">PREPARE</router-link>
                    </li>
                    <li :class="canNavigate">
                        <router-link to="/plot">PLOT</router-link>
                    </li>
                </ul>

            </div>
        </div>

        <div class="clearfix">
            <router-view v-on:warnModal="enableModal"></router-view>
        </div>

    </div>

</template>

<script>

    import VueRouter from 'vue-router'



    //This About is an example of how to lazy load a route.
    const Prepare = () => import( './views/Prepare.vue')
    const Load = () => import('./views/Load.vue')
    import Plot from './views/Plot.vue'


    // const Foo = () => import('./Foo.vue')

    const router = new VueRouter({
        routes: [
            {path: '/', component: Load},
            {path: '/prepare', component: Prepare},
            {path: '/plot', component: Plot}
        ]
    });


    export default {
        name: 'Container',
        data() {

            return {
                showModal: false
            }
        },

        props: {
            msg: String
        },
        router: router,

        methods: {
            enableModal: function(modal_text) {
                console.log('modal!')
                console.log(modal_text)
                this.showModal = true
            }
        },

        computed: {
            canNavigate: function() {
                let rv = 'nav-item'
                    if (this.$store.state.globalSvg === null){
                        rv = 'cannot-navigate'
                    }

                return rv
            }
        }
    }
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style>
    body{
       background-color: #FCFCFC;
    }

    #app {
        font-family: 'Bebas Neue', Helvetica, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-align: center;
        color: #454545;
        /*color: #2c3e50;*/

        max-width: 1024px;
        margin: auto;
        width: 90%;

    }

    .cannot-navigate a {
        color: #DBDBDB;
        text-decoration: none;
        font-size: 28px;
        font-weight: bold;
    }

    .router-link-exact-active {
        border-bottom: 3px solid #39a8c9;

    }

    h1 {
        margin: 0;
    }

    h3 {
        margin: 40px 0 0;
    }

    ul {

        list-style-type: none;
        padding: 0;
        padding-bottom: -4px;
    }

    li {
        display: inline-block;
        margin: 0 10px;

    }

    .clearfix {
        clear: both;
        padding-top: 15px;
    }

    .logo {
        float: left;
        font-size: 60px;

    }

    .navmenu {
        float: right;
    }


     .nav-item a {
        text-decoration: none;
        color: #454545;
        font-size: 28px;
        font-weight: bold;

    }

    .nav-container {
        padding-top: 10px;
        height: 40px
    }


    .plot-button{
        color:#FCFCFC;
        font-size: 42px;
        background: #39a8c9;
        text-align: center;
        /*width:125px;*/
        height:50px;
        /*margin:auto;*/
        cursor: pointer;
        margin-bottom: 20px;
    }

    .terminate-button{
        color:#FCFCFC;
        font-size: 42px;
        background: #c93939;
        text-align: center;
        /*width:125px;*/
        height:50px;
        /*margin:auto;*/
        cursor: pointer;
    }
       .pause-button{
        color:#FCFCFC;
        font-size: 42px;
        background: #39a8c9;
        /*background: #f1d927;*/
        text-align: center;
        /*width:125px;*/
        height:50px;
        /*margin:auto;*/
        cursor: pointer;
    }

</style>
