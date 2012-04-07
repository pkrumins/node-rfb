var assert = require('assert');
var qemu = require('./lib/qemu');
var RFB = require('rfb');

exports.password = function () {
    var port = Math.floor(Math.random() * (Math.pow(2,16) - 10000)) + 10000;
    console.log('gvncviewer :' + (port - 5900));
    var q = qemu({ port : port, password : true });
    
    var to = 'monitor dimensions'
        .split(' ')
        .reduce(function (acc, name) {
            acc[name] = setTimeout(function () {
                assert.fail('never reached ' + name);
            }, 60000);
            return acc;
        }, {})
    ;
    
    q.stdout.on('data', function fn (buf) {
        if (buf.toString().match(/^\(qemu\)/m)) {
            clearTimeout(to.monitor);
            
            q.stdout.removeListener('data', fn);
            setTimeout(function () {
                q.stdin.write('change vnc password\n');
                q.stdin.write('moo\n');
            }, 50);
            
            setTimeout(function () {
                var r = new RFB({
                    port : port,
                    password : 'moo',
                    securityType : 'vnc',
                });
                
                r.on('unknownRect', function () {
                    assert.fail('caught on unknownRect');
                });
                
                r.requestRedraw();
                r.dimensions(function (dims) {
                    clearTimeout(to.dimensions);
                    assert.eql(dims, { width : 720, height : 400 });
                    setTimeout(function () {
                        q.stdin.write('quit\n');
                    }, 500);
                });
            }, 15000);
        }
    });
};
