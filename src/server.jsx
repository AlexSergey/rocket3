import dotenv from 'dotenv';
import Koa from 'koa';
import serve from 'koa-static';
import logger from 'koa-logger';
import Router from 'koa-router';
import readHTMLStream from './isomorphic/readHTMLStream';
import { Readable } from 'stream';
import path from 'path';
import React from 'react';
import App from './App';
import { renderToString, renderToNodeStream } from 'react-dom/server';
import StyleContext from 'isomorphic-style-loader/StyleContext';
import { StaticRouter } from 'react-router-dom';
import { Provider as ReduxProvider } from 'react-redux';
import ignoreFiles from './isomorphic/ignoreFiles';
import { END } from 'redux-saga';
import createStore from './store';
import { createMemoryHistory } from 'history';
import { renderHeader, renderFooter } from './isomorphic/render';
import MetaTagsServer from 'react-meta-tags/server';
import { MetaTagsContext } from 'react-meta-tags';
import sourceMapSupport from 'source-map-support';
import { ChunkExtractor } from '@loadable/server';

dotenv.config({
    path: path.resolve(__dirname, '../', '.env')
});

const app = new Koa();
app.use(logger());
app.use(serve(path.resolve( __dirname, '../public' )));
app.use(ignoreFiles(['ico']));
const router = new Router();

const currentFolder = path.basename(process.cwd());

const webExtractor = new ChunkExtractor({
    statsFile: currentFolder === 'dist' ?
        path.resolve('./stats.json') :
        path.resolve('./dist/stats.json'),
    entrypoints: ['index']
});

function createJSX(ctx, context, metaTagsInstance, reduxState = {}) {
    const history = createMemoryHistory();
    const { store, rootSaga } = createStore(history, reduxState);

    const css = new Set();
    const insertCss = (...styles) => styles.forEach(style => css.add(style._getCss()));

    const jsx = webExtractor.collectChunks(
        <StyleContext.Provider value={{ insertCss }}>
            <ReduxProvider store={store}>
                <MetaTagsContext extract={metaTagsInstance.extract}>
                    <StaticRouter context={context} location={ctx.request.url}>
                        <App />
                    </StaticRouter>
                </MetaTagsContext>
            </ReduxProvider>
        </StyleContext.Provider>
    );

    return { jsx, store, css, rootSaga };
}

router.get('/*', async ctx => {
    let jsx, store, css, appCurrent;
    const stream = new Readable();
    const metaTagsInstance = MetaTagsServer();
    const context = {};
    appCurrent = createJSX(ctx, context, metaTagsInstance, {});
    jsx = appCurrent.jsx;
    store = appCurrent.store;
    css = appCurrent.css;
    renderToString(jsx);

    const meta = metaTagsInstance.renderToString();

    store.dispatch(END);
    await appCurrent.rootSaga.toPromise();

    const reduxState = store.getState();

    stream.push(renderHeader(meta));
    ctx.status = 200;
    ctx.res.write(renderHeader(meta));

    appCurrent = createJSX(ctx, context, metaTagsInstance, reduxState);
    jsx = appCurrent.jsx;

    const htmlSteam = renderToNodeStream(jsx);
    htmlSteam.pipe(ctx.res, { end: false });
    await readHTMLStream(htmlSteam);

    let scripts = '<script  src="/vendor.js" type="text/javascript"></script>\n';

    scripts += webExtractor.getScriptTags();

    ctx.res.write(
        renderFooter(
            reduxState,
            process.env.NODE_ENV === 'development' ?
                `<style type="text/css">${[...css].join('')}</style>` :
                `<link rel="stylesheet" type="text/css" href="/styles.css" />`,
            scripts
        )
    );
    ctx.res.end();
});

app
    .use(router.routes())
    .use(router.allowedMethods());

const server = app.listen(process.env.ISOMORPHIC_SERVER_PORT, () => {
    if (process.env.NODE_ENV === 'development') {
        console.log(`LiveReload connected to ${process.env.__LIVE_RELOAD__} port`);
    }
    console.log(`http://localhost:${process.env.ISOMORPHIC_SERVER_PORT}/`);
    console.log(`Server connected to ${process.env.ISOMORPHIC_SERVER_PORT} port`);
});

function handleError(err, ctx) {
    if (ctx == null) {
        console.error('Unhandled exception occurred');
    }
}

async function terminate(signal) {
    server.close();
    process.exit(signal);
}

server.on('error', handleError);

['unhandledRejection', 'uncaughtException'].map(error => {
    process.on(error, handleError);
});

['SIGTERM', 'SIGINT', 'SIGUSR2'].map(signal => {
    process.once(signal, () => terminate(signal));
});

if (process.env.NODE_ENV === 'development') {
    sourceMapSupport.install();
}
