// Copyright (C) 2017-2023 Smart code 203358507

const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const webpack = require('webpack');
const threadLoader = require('thread-loader');
const HtmlWebPackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const WorkboxPlugin = require('workbox-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const packageJson = require('./package.json');

const COMMIT_HASH = execSync('git rev-parse HEAD').toString().trim();
const WEBOS_TRANSPILE_PACKAGES = ['i18next', 'react-i18next', 'use-long-press'];

const isEnabled = (value) => value === true || value === '1' || value === 'true';

const shouldExcludeNodeModule = (resourcePath) => {
    const normalizedPath = `/${resourcePath.replace(/\\/g, '/')}`;

    if (!normalizedPath.includes('/node_modules/')) return false;

    return !WEBOS_TRANSPILE_PACKAGES.some((packageName) => (
        normalizedPath.includes(`/node_modules/${packageName}/`)
        || normalizedPath.endsWith(`/node_modules/${packageName}`)
    ));
};

const THREAD_LOADER = {
    loader: 'thread-loader',
    options: {
        name: 'shared-pool',
        workers: os.cpus().length,
    },
};

threadLoader.warmup(
    THREAD_LOADER.options,
    [
        'babel-loader',
        'ts-loader',
        'css-loader',
        'postcss-loader',
        'less-loader',
    ],
);

module.exports = (env = {}, argv) => {
    const webos = isEnabled(env.WEBOS);
    const serviceWorkerDisabled = isEnabled(env.SERVICE_WORKER_DISABLED);
    for (const [key, limit] of [['WEBOS_OVERSCAN_HORIZONTAL', 960], ['WEBOS_OVERSCAN_VERTICAL', 540]]) {
        if (webos && env[key] !== undefined && (!Number.isFinite(Number(env[key])) || Number(env[key]) < 0 || Number(env[key]) >= limit)) {
            throw new Error(`${key} must be a non-negative pixel value below ${limit}`);
        }
    }
    const webosDebug = webos && isEnabled(env.WEBOS_DEBUG);
    const nodeModulesExclude = webos ? shouldExcludeNodeModule : /node_modules/;
    const mainEntry = webos ? [
        // Workers have their own global scope, so each webOS entry needs this first.
        'core-js/stable',
        ...(webosDebug ? ['./src/webos/diagnostics/bootstrap.js'] : []),
        './src/index.js',
    ] : './src/index.js';
    const workerEntry = webos ? [
        'core-js/stable',
        './node_modules/@stremio/stremio-core-web/worker.js',
    ] : './node_modules/@stremio/stremio-core-web/worker.js';

    return {
    mode: argv.mode,
    devtool: argv.mode === 'production' ? 'source-map' : 'eval-source-map',
    entry: {
        main: mainEntry,
        worker: workerEntry,
    },
    output: {
        path: path.join(__dirname, 'build'),
        filename: `${COMMIT_HASH}/scripts/[name].js`,
        clean: true,
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: nodeModulesExclude,
                use: [
                    THREAD_LOADER,
                    {
                        loader: 'babel-loader',
                        options: {
                            presets: [
                                ['@babel/preset-env', {
                                    browserslistEnv: webos ? 'webos' : undefined,
                                    ignoreBrowserslistConfig: !webos,
                                }],
                                '@babel/preset-react'
                            ],
                        }
                    }
                ]
            },
            {
                test: /\.(ts|tsx)$/,
                exclude: /node_modules/,
                use: [
                    THREAD_LOADER,
                    {
                        loader: 'ts-loader',
                        options: {
                            configFile: path.resolve(__dirname, webos ? 'tsconfig.webos.json' : 'tsconfig.json'),
                            happyPackMode: true,
                        }
                    }
                ]
            },
            {
                test: /\.less$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: MiniCssExtractPlugin.loader,
                        options: {
                            esModule: false
                        }
                    },
                    THREAD_LOADER,
                    {
                        loader: 'css-loader',
                        options: {
                            esModule: false,
                            importLoaders: 2,
                            modules: {
                                namedExport: false,
                                localIdentName: '[local]-[hash:base64:5]'
                            }
                        }
                    },
                    {
                        loader: 'postcss-loader',
                        options: {
                            postcssOptions: {
                                plugins: [
                                    ['cssnano', {
                                        preset: [
                                            'advanced',
                                            {
                                                autoprefixer: {
                                                    env: webos ? 'webos' : undefined,
                                                    add: true,
                                                    remove: true,
                                                    flexbox: false,
                                                    grid: false
                                                },
                                                cssDeclarationSorter: true,
                                                calc: false,
                                                colormin: false,
                                                convertValues: false,
                                                discardComments: {
                                                    removeAll: true,
                                                },
                                                discardOverridden: false,
                                                discardUnused: false,
                                                mergeIdents: false,
                                                normalizeDisplayValues: false,
                                                normalizePositions: false,
                                                normalizeRepeatStyle: false,
                                                normalizeUnicode: false,
                                                normalizeUrl: false,
                                                reduceIdents: false,
                                                reduceInitial: false,
                                                zindex: false
                                            }
                                        ]
                                    }]
                                ]
                            }
                        }
                    },
                    {
                        loader: 'less-loader',
                        options: {
                            lessOptions: {
                                strictMath: true,
                                ieCompat: false,
                                modifyVars: {
                                    webos: webos ? 'true' : 'false',
                                    ...(webos && env.WEBOS_OVERSCAN_HORIZONTAL !== undefined ? {
                                        'webos-overscan-horizontal': `${Number(env.WEBOS_OVERSCAN_HORIZONTAL)}px`
                                    } : {}),
                                    ...(webos && env.WEBOS_OVERSCAN_VERTICAL !== undefined ? {
                                        'webos-overscan-vertical': `${Number(env.WEBOS_OVERSCAN_VERTICAL)}px`
                                    } : {})
                                }
                            }
                        }
                    }
                ]
            },
            {
                test: /\.(ttf|woff2)$/,
                exclude: /node_modules/,
                type: 'asset/resource',
                generator: {
                    filename: 'fonts/[name][ext][query]'
                }
            },
            {
                test: /\.(png|jpe?g|svg)$/,
                exclude: /node_modules/,
                type: 'asset/resource',
                generator: {
                    filename: 'images/[name][ext][query]'
                }
            },
            {
                test: /\.wasm$/,
                type: 'asset/resource',
                generator: {
                    filename: `${COMMIT_HASH}/binaries/[name][ext][query]`
                }
            }
        ]
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js', '.json', '.less', '.wasm'],
        alias: {
            'stremio': path.resolve(__dirname, 'src'),
            'stremio-router': path.resolve(__dirname, 'src', 'router'),
            ...(webosDebug ? {
                'stremio-router-base-paths$': path.resolve(
                    __dirname,
                    'src',
                    'router',
                    'routerPaths.tsx'
                )
            } : {})
        }
    },
    devServer: {
        host: '0.0.0.0',
        static: false,
        hot: false,
        server: 'https',
        liveReload: false
    },
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({
                test: /\.js$/,
                extractComments: false,
                terserOptions: {
                    ecma: 5,
                    mangle: true,
                    warnings: false,
                    output: {
                        comments: false,
                        beautify: false,
                        wrap_iife: true
                    }
                }
            })
        ]
    },
    plugins: [
        new webpack.ProgressPlugin(),
        new webpack.EnvironmentPlugin({
            SENTRY_DSN: null,
            ...env,
            SERVICE_WORKER_DISABLED: serviceWorkerDisabled,
            DEBUG: argv.mode !== 'production',
            VERSION: packageJson.version,
            COMMIT_HASH,
            WEBOS: webos,
            WEBOS_DEBUG: webosDebug
        }),
        serviceWorkerDisabled && new webpack.NormalModuleReplacementPlugin(
            /[\\/]App[\\/]WebUpdateScreen$/,
            path.resolve(__dirname, 'src', 'App', 'WebUpdateScreen', 'disabled.js')
        ),
        webosDebug && new webpack.NormalModuleReplacementPlugin(
            /[\\/]routerPaths$/,
            path.resolve(__dirname, 'src', 'router', 'routerPaths.webos.tsx')
        ),
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer']
        }),
        argv.mode === 'production' && !serviceWorkerDisabled &&
            new WorkboxPlugin.GenerateSW({
                maximumFileSizeToCacheInBytes: 20000000,
                clientsClaim: true,
                // webOS applies updates through the banner; desktop keeps its existing policy.
                skipWaiting: !webos
            }),
        new CopyWebpackPlugin({
            patterns: [
                { from: 'assets/favicons', to: 'favicons' },
                { from: 'assets/images', to: 'images' },
                { from: 'assets/screenshots/*.webp', to: 'screenshots/[name][ext]' },
                { from: '.well-known', to: '.well-known' },
                { from: 'manifest.json', to: 'manifest.json' },
                ...(webos ? [
                    {
                        from: 'webos/lib/webOSTVjs-1.2.10/webOSTV.js',
                        to: 'webos/webOSTV.js',
                        info: { minimized: true },
                    },
                ] : []),
            ]
        }),
        new MiniCssExtractPlugin({
            filename: `${COMMIT_HASH}/styles/[name].css`
        }),
        new HtmlWebPackPlugin({
            template: './src/index.html',
            inject: false,
            scriptLoading: 'blocking',
            faviconsPath: 'favicons',
            imagesPath: 'images',
            webos,
        }),
    ].filter(Boolean)
    };
};
