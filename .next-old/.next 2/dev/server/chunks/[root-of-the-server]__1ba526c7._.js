module.exports = [
"[externals]/crypto [external] (crypto, cjs, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.resolve().then(() => {
        return parentImport("[externals]/crypto [external] (crypto, cjs)");
    });
});
}),
"[project]/node_modules/https-proxy-agent/dist/index.js [app-route] (ecmascript, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.resolve().then(() => {
        return parentImport("[project]/node_modules/https-proxy-agent/dist/index.js [app-route] (ecmascript)");
    });
});
}),
"[project]/node_modules/google-gax/node_modules/node-fetch/src/index.js [app-route] (ecmascript, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.all([
  "server/chunks/b824c_node-fetch_src_utils_multipart-parser_df940912.js",
  "server/chunks/node_modules_d52a9894._.js",
  "server/chunks/[externals]__2dbc566f._.js"
].map((chunk) => __turbopack_context__.l(chunk))).then(() => {
        return parentImport("[project]/node_modules/google-gax/node_modules/node-fetch/src/index.js [app-route] (ecmascript)");
    });
});
}),
"[externals]/fs [external] (fs, cjs, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.resolve().then(() => {
        return parentImport("[externals]/fs [external] (fs, cjs)");
    });
});
}),
];