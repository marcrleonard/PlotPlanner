proxyTable: {
    "/":{
        target: "http://127.0.0.1:5001",
        changeOrigin: true,
        secure: false,
//         pathRewrite:{
//             "^/api":"/api"
//         }
    }

// this.$axios.get("/api/user/login?username=xx&password=123")
//     .then(function (response) {
//         console.log(response);
//     })
//     .catch(function (error) {
//         console.log(error);
//     });