var assert = require('assert');

var qemu = require('./lib/qemu');
var RFB = require('rfb');

var Seq = require('seq');
var Hash = require('hashish');
var util = require('util');

exports.rects = function () {
    var port = Math.floor(Math.random() * (Math.pow(2,16) - 10000)) + 10000;
    var q = qemu({ port : port });
    console.log('gvncviewer :' + (port - 5900));
    
    var to = 'dimensions keys mouse'
        .split(' ')
        .reduce(function (acc, name) {
            acc[name] = setTimeout(function () {
                assert.fail('never reached ' + name);
            }, 60000);
            return acc;
        }, {})
    ;
    
    setTimeout(function () {
        var r = new RFB({ port : port });
        
        r.on('unknownRect', function (rect) {
            var rep = util.inspect(rect);
            assert.fail(
                'unknown rect: '
                + (rep.length > 100 ? rep.slice(0,100) + '...' : rep)
            );
        });
        
        r.requestRedraw();
        r.dimensions(function (dims) {
            clearTimeout(to.dimensions);
            assert.eql(dims, { width : 720, height : 400 });
            
            setTimeout(sendKeys, 5000, r);
        });
    }, 10000);
    
    function sendKeys (r) {
        Seq.ap('xinit'.split(''))
            .seqEach_(function (next, key) {
console.log(key);
                r.once('raw', function (rect) {
console.dir([ rect.width, rect.height ].join(' x '));
                    assert.ok(
                        rect.width <= 32 && rect.height <= 32,
                        'rect at (' + rect.x + ',' + rect.y + ') '
                        + 'is too big: ' + rect.width + 'x' + rect.height
                    );
                    setTimeout(next, 250);
                });
                
                r.sendKeyDown(key.charCodeAt(0));
                r.sendKeyUp(key.charCodeAt(0));
            })
            .seq_(function (next) {
                clearTimeout(to.keys);
                
                // send a newline
                r.sendKeyDown(65293);
                r.sendKeyUp(65293);
                
                var toResize = setTimeout(function () {
                    assert.fail('never resized');
                }, 8000);
                
                r.on('desktopSize', function fn (rect) {
                    if (rect.width === 640 && rect.height === 480) {
                        clearTimeout(toResize);
                        setTimeout(next, 3000);
                    }
                });
            })
            .seq_(function (next) {
                var x = 300;
                var y = 300;
                
                var toMouse = setTimeout(function () {
                    assert.fail('mouse never moved');
                }, 15000);
                
                setTimeout(function () {
                    r.once('raw', function (ref) {
                        setTimeout(function () {
                            r.sendPointer(x + 100, y, 0);
                            r.on('raw', function fn (rect) {
                                clearTimeout(toMouse);
                                next();
                            });
                        }, 200);
                    });
                    
                    r.sendPointer(x, y, 0);
                }, 100);
                
                r.sendPointer(x-2, y, 0);
                r.sendPointer(x-1, y, 0);
            })
            .seq(function () {
                clearTimeout(to.mouse);
                
                setTimeout(function () {
                    q.stdin.write('quit\n');
                }, 500);
            })
        ;
    }
};
