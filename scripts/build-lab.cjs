#!/usr/bin/env node
// build-lab.cjs — compile the Trade Lab engine source to the served file.
//
// This repo hosts the COMPILED lab (plain JS, no in-browser Babel). The
// engine's readable source lives in lab-src/trade-calc-lab.js; this script
// compiles it with the same Babel preset + esbuild minify the production
// pipeline uses, writing js/trade-calc-lab.js. The lab modules under js/lab/
// are plain JS and ship as-is. Run after every lab-src edit, commit both.
//
// Toolchain: borrows the checked-out Owner-Dashboard---V6 node_modules
// (@babel/standalone + esbuild) — override with LAB_TOOLCHAIN if that path
// ever moves.

const fs = require('fs');
const path = require('path');

const TOOLCHAIN = process.env.LAB_TOOLCHAIN || '/home/user/Owner-Dashboard---V6/node_modules';
const Babel = require(path.join(TOOLCHAIN, '@babel/standalone'));
const esbuild = require(path.join(TOOLCHAIN, 'esbuild'));

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'lab-src', 'trade-calc-lab.js');
const OUT = path.join(ROOT, 'js', 'trade-calc-lab.js');

const code = fs.readFileSync(SRC, 'utf8');
const compiled = Babel.transform(code, {
  filename: 'trade-calc-lab.js',
  presets: [['react', { runtime: 'classic' }]],
  sourceType: 'script',
  sourceMaps: false,
  comments: false,
}).code;
const min = esbuild.transformSync(compiled, {
  loader: 'js', minify: true, legalComments: 'none', target: 'es2019',
}).code;
fs.writeFileSync(OUT, min + '\n', 'utf8');
console.log('[build-lab] js/trade-calc-lab.js <- lab-src (' + min.length + ' bytes)');
