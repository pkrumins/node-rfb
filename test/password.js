var assert = require('assert');
var qemu = require('./lib/qemu');
var RFB = require('rfb');

exports.password = function () {
    var port = Math.floor(Math.random() * (Math.pow(2,16) - 10000)) + 10000;
    var q = qemu(
        '-vnc', ':' + (port - 5900) + ',password',
        qemu.img, '-monitor', 'stdio'
    );
    
    var to = 'monitor dimensions'
        .split(' ')
        .reduce(function (acc, name) {
            acc[name] = setTimeout(function () {
                assert.fail('never reached ' + name);
            }, 10000);
            return acc;
        }, {})
    ;
    
    q.stdout.on('data', function fn (buf) {
        if (buf.toString().match(/^\(qemu\)/m)) {
            clearTimeout(to.monitor);
            
            q.stdout.removeListener('data', fn);
            q.stdin.write('change vnc password\n');
            q.stdin.write('moo\n');
            
            setTimeout(function () {
                var r = new RFB({
                    port : port,
                    password : 'moo',
                    securityType : 'vnc',
                });
                r.requestRedraw();
                r.dimensions(function (dims) {
                    clearTimeout(to.dimensions);
                    assert.eql(dims, { width : 720, height : 400 });
                    setTimeout(function () {
                        q.stdin.write('quit\n');
                    }, 500);
                });
            }, 5000);
        }
    });
};
