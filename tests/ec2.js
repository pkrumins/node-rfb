var RFB = require('rfb');
var Png = require('png').Png;
var fs = require('fs');

var host = 'ec2-184-72-203-1.compute-1.amazonaws.com';
var port = 443;

var rfb = new RFB({
    host : host,
    port : port,
    engine : 'tightvnc'
});

rfb.on('raw', function (raw) {
    console.log('screen %sx%s', raw.width, raw.height);
    var png = new Png(raw.fb, raw.width, raw.height, 'bgra');
    var file = 'ec2.png';
    png.encode(function (data, error) {
        if (error) {
            throw new Error(error);
        }
        fs.writeFileSync(file, data.toString('binary'), 'binary');
        console.log(file + ' written');
        process.exit(0);
    });
});
