// rfb client module
// http://www.realvnc.com/docs/rfbproto.pdf

var sys = require('sys');
var net = require('net');
var Buffer = require('buffer').Buffer;
var BufferList = require('bufferlist').BufferList;

exports.RFB = RFB;
function RFB(host, port, opts) {
    var rfb = this;
    if (typeof(opts) == 'undefined') opts = {};
    
    rfb.shared = opts.shared || false;
    rfb.securityType = opts.securityType || 'none';
    
    var stream = new net.Stream;
    var buffer = new BufferList;
    var parser = new Parser();
    
    stream.addListener('connect', function () {
        stream.write('RFB 003.008\n');
    });
    
    stream.addListener('data', function (data) {
        buffer.push(data);
        parser.parse(rfb,buffer);
    })
    stream.connect(5900);
    
    this.end = function () {
        stream.end();
    };
}

exports.Parser = Parser;
function Parser () {
    // the active parser rule
    var rule = versionHandshake;
    
    // Takes an rfb object and a BufferList
    this.parse = function (rfb, buffer) {
        var r = rule(rfb, buffer);
        if (r == _error) rfb.end();
        else if (r) rule = r;
    };
    
    function _error () {}
    function error (msg) {
        sys.log(msg);
        return _error;
    }
    
    function versionHandshake (rfb, buffer) {
        if (buffer.length < 12) return;
        var m = buffer.take(12).match(/^RFB (\d{3}\.\d{3})/);
        if (!m) return error(
            "Couldn't parse version handshake: " + buffer.take(12)
        );
        
        var version = Number(m[1]);
        if (version < 3.008) return error(
            "Remote version (" + version + ") too old (< 3.008)"
        );
        buffer.advance(12);
        
        return securityHandshake;
    }
    
    function securityHandshake (rfb, buffer) {
        sys.log('sec');
        return;
    }
    
    function initHandshake (rfb, buffer) {
        sys.log('init');
        return;
    }
}
