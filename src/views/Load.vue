<template>

    <div

            class="page-container">
<!--        <button v-on:click="fireModal" > MODAL!!!!</button>-->
        <div
        v-cloak @drop.prevent="getDragFile" @dragover.prevent
            v-on:dragover="onDragOver"
            v-on:dragexit="onDragExit"
            id="drop-container"
        class="full-screen"
        ></div>
        <div class="drop-border flex-center-vertically ">

                <svg class="drop-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 204 179">

                  <g id="Symbol_2_1" data-name="Symbol 2 – 1" transform="translate(-858.5 -408)">
                    <path id="Path_5" data-name="Path 5" class="cls-1" d="M0,0H202.658" transform="translate(858.5 584)"/>
                    <path id="Path_6" data-name="Path 6" class="cls-1" d="M0,87V0" transform="translate(861.5 497)"/>
                    <path id="Path_2" data-name="Path 2" class="cls-2" d="M0,89.717V0" transform="translate(1059.5 497)"/>
                    <line id="Line_5" data-name="Line 5" class="cls-1" y1="118" transform="translate(960.5 408)"/>
                    <path id="Path_3" data-name="Path 3" class="cls-3" d="M41,41,0,0" transform="translate(919.5 485)"/>
                    <path id="Path_4" data-name="Path 4" class="cls-1" d="M0,43,43,0" transform="translate(958.5 485)"/>
                  </g>
                </svg>

            <h2 class="blue-text pb-15">drop svg here</h2>
        </div>

    </div>

</template>

<script>


    export default {
        name: 'Load',

        data() {
            return {
                areHovering:false
            }
        },
        computed : {
            hoverClass : function(){

                if (this.areHovering){
                    return 'drop-border-hover'
                }
                else {
                    return 'drop-border'
                }
            }
        },
        methods: {

            makeChange(val) {
                console.log(val)
            },

            fireModal(){
                console.log('fire modale?')
                let mm = this.$emit('warnModal', 'modal body')
                console.log(mm)
            },

            onDragOver() {
                console.log('hovering over')
                this.areHovering=true
                // event.currentTarget.style.borderColor = '#39a8c9';

            },
            onDragExit() {
                console.log('leaving hover')
                this.areHovering=false
                // event.currentTarget.style.borderColor = '#DBDBDB';
            },

            getDragFile(event) {
                event.preventDefault();
                console.log('File(s) dropped');
                // Prevent default behavior (Prevent file from being opened)

                if (event.dataTransfer.items) {
                    // Use DataTransferItemList interface to access the file(s)
                    for (let i = 0; i < event.dataTransfer.items.length; i++) {
                        // If dropped items aren't files, reject them
                        if (event.dataTransfer.items[i].kind === 'file') {


                            var file = event.dataTransfer.items[i].getAsFile();

                            var tmppath = URL.createObjectURL(file);
                            console.log(tmppath)

                            let xhr = new XMLHttpRequest();
                            xhr.open("GET",tmppath,false);

                            xhr.overrideMimeType("image/svg+xml");


                            xhr.onload  = (e) => {
                                console.log(e)
                              // You might also want to check for xhr.readyState/xhr.status here

                                // this.$store.commit('setSvg')

                                this.changeStateGlobal(xhr.responseXML.documentElement)

                              // document.getElementById("svgContainer")
                              //   .appendChild(xhr.responseXML.documentElement);

                            }
                            xhr.send("");

                        }
                    }
                } else {
                    // Use DataTransfer interface to access the file(s)
                    for (let i = 0; i < event.dataTransfer.files.length; i++) {
                        console.log('... file[' + i + '].name = ' + event.dataTransfer.files[i].name);
                    }
                }
                event.currentTarget.style.borderColor = '#DBDBDB'
                this.$router.push({ path: 'prepare' })

            },

            changeStateGlobal(svg) {
                // this.$store.commit('increment')
                // this.$store.commit('setSvg')
                console.log(svg)
                this.$store.commit('setOriginalSvg', svg)
                this.$store.commit('setSvg', svg)
            }

        }
    }

</script>

<style>
    .pb-15 {
        padding-bottom: 15px;
    }
    .page-container{
        margin-top:20px;
        height: 80vh
    }

    .blue-text {
        color: #39a8c9;
    }

    .drop-border-hover {
        border-color : #39a8c9;
    }


    .drop-border {

        width: 300px;
        border-style: dashed;
        border-width: 6px;
        border-color: #DBDBDB;
        margin: auto
    }




    .drop-icon {

        width: 150px;
        padding: 40px 25px 5px 25px;
    }


    /*SVG STYLES*/

          .cls-1 {
        fill: none;
      }

      .cls-1, .cls-2, .cls-3 {
        stroke: #dbdbdb;
        stroke-width: 6px;
      }

      .cls-2 {
        fill: #39a8c9;
      }

      .cls-3 {
        fill: #dbdbdb;
      }

    .full-screen {
        position: absolute;
        top:0;
        left: 0;
        z-index: 100;
        width: 100vw;
        height: 100vh;
        background:rgba(0, 0, 0, 0);

    }

    .bg-overlay {


    }

    .modal-container {
        margin-top: 150px;
        margin-left:auto;
        margin-right:auto;
        width:400px;
        height:300px;
        background: #FCFCFC;
        opacity:100% !important;

    }


</style>
