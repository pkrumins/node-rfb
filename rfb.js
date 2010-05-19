// rfb client module
// http://www.realvnc.com/docs/rfbproto.pdf

var sys = require('sys');
var net = require('net');
var Buffer = require('buffer').Buffer;
var BufferList = require('bufferlist').BufferList;
var Binary = require('bufferlist/binary').Binary;

exports.RFB = RFB;
function RFB(opts) {
    var rfb = this;
    if (typeof(opts) == 'undefined') opts = {};
    
    rfb.host = opts.host || 'localhost';
    rfb.port = opts.port || 5900;
    rfb.shared = opts.shared || false;
    rfb.securityType = opts.securityType || 'none';
    
    var stream = new net.Stream;
    var bufferList = new BufferList;
    var parser = new Parser(rfb, bufferList);
    
    stream.addListener('connect', function () {
        stream.write('RFB 003.008\n');
    });
    
    stream.addListener('data', function (data) {
        bufferList.push(data);
    })
    
    stream.setNoDelay();
    stream.connect(rfb.port, rfb.host);
    
    this.send = function (msg) {
        stream.write(msg, 'binary');
        stream.flush();
        return this;
    }
    
    this.end = function () {
        stream.end();
        return this;
    };
}

exports.Parser = Parser;
function Parser (rfb, bufferList) {
    Binary(bufferList)
        // version handshake
        .getBuffer('prelude',12)
        .tap(function (vars) {
            var m = vars.prelude.toString().match(/^RFB (\d{3}\.\d{3})/);
            if (!m) {
                sys.log("Couldn't parse version handshake: " + vars.prelude);
                this.clear();
            }
            else {
                var version = Number(m[1]);
                if (version < 3.008) {
                    sys.log('Remote version ' + version + ' < 3.008');
                    this.clear();
                }
                rfb.send('RFB 003.008\n');
            }
        })
        .flush()
        // security handshake
        .getWord8('secLen')
        .when('secLen', 0, function (vars) {
            this
                .clear()
                .getWord8('msgLen')
                .getBuffer('msg','msgLen')
                .tap(function (vars) {
                    sys.log(
                        'Server returned error in security handshake: '
                        + vars.msg.toString()
                    );
                })
            ;
        })
        .getBuffer('secTypes','secLen')
        .tap(function (vars) {
            // vars.secTypes is a Buffer object; make an array
            var secTypes = [];
            for (var i = 0; i < vars.secTypes.length; i++) {
                secTypes.push(vars.secTypes[i]);
            }
            
            var secNum = {
                'none' : 1
            }[rfb.securityType];
            
            if (secTypes.indexOf(secNum) < 0) {
                sys.log('Security type ' + rfb.securityType + ' not supported');
                this.clear();
            }
            rfb.send(String.fromCharCode(secNum));
        })
        .flush()
        .getWord32be('secRes')
        .tap(function (vars) {
            sys.p(vars);
            sys.p(vars.secRes);
        })
        .unless('secRes', 0, function (vars) {
            sys.log('0 for some reason!');
            this
                .tap(function (vars) { sys.p(vars.secRes) })
                .clear()
                .getWord8('msgLen')
                .tap(function (vars) { sys.p(vars.msgLen) })
                .getBuffer('msg')
                .tap(function (vars) {
                    sys.log('Security handshake failed with message: '
                        + vars.msg.toString()
                    );
                });
            ;
        })
        .tap(function (vars) {
            sys.p(vars);
        })
        .flush()
        // init handshake
        .tap(function (vars) {
            sys.log('init');
            rfb.send(String.fromCharCode(rfb.shared));
            sys.log('now get framebuffer')
        })
    ;
}
