#!/usr/bin/env node
// Write out png files for every raw framebuffer update.

var sys = require('sys');
var fs = require('fs');

var Png = require('png').Png;
var RFB = require('rfb').RFB;

var rfb = new RFB({ port : process.argv[2] || 5900 });
rfb.requestRedraw();

var counter = 0;
rfb.addListener('raw', function (raw) {
    var png = new Png(raw.fb, raw.width, raw.height, 'rgb');
    var filename = 'fb-' + (counter ++) + '.png';
    png.encode(function (data, error) {
        if (error) {
            console.log('Error: ' + error.toString());
            process.exit(1);
        }
        fs.writeFileSync(filename, data, 'binary');
        sys.log(filename + ' written');
    });
});
