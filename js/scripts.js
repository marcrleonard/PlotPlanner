// var button = document.getElementById("saveButton");


// // 3. Add event handler
// button.addEventListener("onclick", function () {

// });

saveButton = function () {
    console.log('asdasd')
    alert("did something");
    saveSVG();
}



saveSVG = function () {

    //get svg element.
    var svg = document.getElementById("shadow");

    //get svg source.
    var serializer = new XMLSerializer();
    var source = serializer.serializeToString(svg);

    //add name spaces.
    if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
        source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    if (!source.match(/^<svg[^>]+"http\:\/\/www\.w3\.org\/1999\/xlink"/)) {
        source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    }

    //add xml declaration
    source = '<?xml version="1.0" standalone="no"?>\r\n' + source;

    //convert svg source to URI data scheme.
    var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);

    //set url value to a element's href attribute.
    link = document.getElementById("link")
    link.href = url;

    link.download = 'myAwesomeSVG.svg';
    //you can download svg file by right click menu.


}

// var hover = [];


// // function overYo(item){

// //     console.log(item);

// //     fill = document.getElementById(item.id).style.fill;
// //     if (fill == 'red'){
// //         document.getElementById(item.id).style.fill = 'blue';
// //     }
// //     else {
// //         document.getElementById(item.id).style.fill = 'red';
// //     };
// // };




// document.addEventListener("DOMContentLoaded", function (event) {

//     d3.xml("test.svg").mimeType("image/svg+xml").get(function(error, xml) {
//     if (error) throw error;
//         d3.select("#svgEmbed").node().appendChild(xml.documentElement);
//     });

//     // d3.selectAll("path").style("color", "green");


//     // a = document.getElementById("alphasvg");

//     // // It's important to add an load event listener to the object,
//     // // as it will load the svg doc asynchronously
//     // a.addEventListener("load", function () {

//     //     // get the inner DOM of alpha.svg
//     //     var svgDoc = a.contentDocument;
//     //     // get the inner element by id
//     // }, false);
// });

