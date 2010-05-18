// rfb client module
// http://www.realvnc.com/docs/rfbproto.pdf

var sys = require('sys');
var net = require('net');
var Buffer = require('buffer').Buffer;
var BufferList = require('bufferlist').BufferList;

exports.RFB = RFB;
function RFB(opts) {
    var rfb = this;
    if (typeof(opts) == 'undefined') opts = {};
    
    rfb.host = opts.host || 'localhost';
    rfb.port = opts.port || 5900;
    rfb.shared = opts.shared || false;
    rfb.securityType = opts.securityType || 'none';
    
    var stream = new net.Stream;
    var buffer = new BufferList;
    var parser = new Parser(rfb, buffer);
    
    stream.addListener('connect', function () {
        stream.write('RFB 003.008\n');
    });
    
    stream.addListener('data', function (data) {
        buffer.push(data);
        parser.parse();
    })
    
    stream.connect(rfb.port, rfb.host);
    
    this.send = function (msg) {
        stream.write(msg);
        return this;
    }
    
    this.end = function () {
        stream.end();
        return this;
    };
}

exports.Parser = Parser;
function Parser (rfb, buffer) {
    // the active parser rule
    var rule = versionHandshake;
    
    // Takes an rfb object and a BufferList
    this.parse = function () {
        var r = rule();
        if (r == _error) rfb.end();
        else if (r) rule = r;
    };
    
    function _error () {}
    function error (msg) {
        sys.log(msg);
        return _error;
    }
    
    // make sure this is actually BE
    function unpackIntBE (bytes) {
        return [ 0,1,2,3 ].reduce(function (i) {
            bytes.charCodeAt(i) * Math.pow(256,i)
        }, 0);
    }
    
    function versionHandshake () {
        if (buffer.length < 12) return;
        var m = buffer.take(12).match(/^RFB (\d{3}\.\d{3})/);
        if (!m) return error(
            "Couldn't parse version handshake: " + buffer.take(12)
        );
        
        var version = Number(m[1]);
        if (version < 3.008) return error(
            'Remote version (' + version + ') too old (< 3.008)'
        );
        
        buffer.advance(12);
        return securityHandshake() || securityHandshake;
    }
    
    function securityHandshake () {
        if (buffer.length < 1) return;
        var secLen = buffer.take(1).charCodeAt(0);
        if (buffer.length - 1 < secLen) return;
        var secTypes = buffer.take(1 + secLen).slice(1).split('')
            .map(function (c) { return c.charCodeAt(0) });
        if (secLen == 0) {
            if (buffer.length < 2) return;
            var msgLen = buffer.take(2).slice(1).charCodeAt(0);
            if (buffer.length < 2 + msgLen) return;
            var msg = buffer.take(2 + msgLen).slice(2);
            return error('Server returned error message: ' + msg);
        }
        var secNum = {
            'none' : 1
        }[rfb.securityType];
        
        if (secTypes.indexOf(secNum) < 0) return error(
            'Security type ' + rfb.securityType + ' not supported'
        );
        
        rfb.send(String.fromCharCode(secNum));
        buffer.advance(1 + secLen);
        
        return function () {
            if (buffer.length < 4) return;
            var secRes = unpackIntBE(buffer.take(4));
            if (secRes == 0) {
                if (buffer.length < 5) return;
                var msgLen = buffer.take(5).charCodeAt(4);
                if (buffer.length < 5 + msgLen) return;
                var msg = buffer.take(5 + msgLen).slice(5);
                return error('Server returned error message: ' + msg);
            }
            
            buffer.advance(4);
            return initHandshake() || initHandshake;
        };
    }
    
    function initHandshake () {
        rfb.send(String.fromCharCode(rfb.shared));
        var fb = getFrameBuffer();
        if (!fb) return;
        rfb.frameBuffer = fb;
    }
    
    function getFrameBuffer() {
        sys.log('get fb');
        return;
    }
}
