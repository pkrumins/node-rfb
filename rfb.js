// rfb client module
// http://www.realvnc.com/docs/rfbproto.pdf

var sys = require('sys');
var net = require('net');

var Buffer = require('buffer').Buffer;
var EventEmitter = require('events').EventEmitter;

var BufferList = require('bufferlist').BufferList;
var Binary = require('bufferlist/binary').Binary;

var clientMsgTypes = {
    setPixelFormat : 0,
    setEncoding : 2,
    fbUpdate : 3,
    keyEvent : 4,
    pointerEvent : 5,
    cutText : 6
};

var serverMsgTypes = {
    fbUpdate : 0,
    setColorMap : 1,
    bell: 2,
    cutText: 3
};

function Word8(x) {
    return String.fromCharCode(x);
}

function Word16be(x) {
    return String.fromCharCode((x>>8)&0xFF) + String.fromCharCode(x&0xFF);
}

function Word32be(x) {
    return String.fromCharCode((x>>24)&0xFF) +
        String.fromCharCode((x>>16)&0xFF) +
        String.fromCharCode((x>>8)&0xFF) +
        String.fromCharCode(x&0xFF);
}

function Pad8() { return "\x00"; }
function Pad16() { return "\x00\x00"; }
function Pad24() { return "\x00\x00\x00"; }

RFB.prototype = new EventEmitter;
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

    stream.addListener('data', function (data) {
        bufferList.push(data);
    });
    
    stream.setNoDelay();
    stream.connect(rfb.port, rfb.host);
    
    this.send = function (msg) {
        stream.write(msg, 'binary');
        return this;
    };
    
    this.end = function () {
        stream.end();
        return this;
    };

    var msgBuf = [];
    this.bufferMsg = function () {
        for (var i = 0; i < arguments.length; i++) {
            msgBuf.push(arguments[i]);
        }
        return this;
    };

    this.sendBuffer = function () {
        var msg = msgBuf.join('');
        msgBuf = [];
        return this.send(msg);
    };
    
    this.sendKey = function (down, key) {
        this.bufferMsg(
            Word8(clientMsgTypes.keyEvent),
            Word8(!!down),
            Pad16(),
            Word32be(key)
        );
        this.sendBuffer();
    };
    
    this.sendKeyDown = function (key) {
        this.sendKey(1, key);
    };
    
    this.sendKeyUp = function (key) {
        this.sendKey(0, key);
    };
    
    this.sendPointer = function (mask, x, y) {
        this.bufferMsg(
            Word8(clientMsgTypes.pointerEvent),
            Word8(mask),
            Word16be(x),
            Word16be(y)
        );
        this.sendBuffer();
    };
}

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
            rfb.send(Word8(secNum));
        })
        .flush()
        .getWord32be('secRes')
        .unless('secRes', 0, function (vars) {
            this
                .clear()
                .getWord8('msgLen')
                .getBuffer('msg')
                .tap(function (vars) {
                    sys.log('Security handshake failed with message: '
                        + vars.msg.toString()
                    );
                });
            ;
        })
        .flush()
        // init handshake
        .tap(function (vars) {
            rfb.send(Word8(rfb.shared));
        })
        .getWord16be('fbWidth')
        .getWord16be('fbHeight')
        .getWord8('pfBitsPerPixel') // pf is pixelFormat
        .getWord8('pfDepth')
        .getWord8('pfBigEndianFlag')
        .getWord8('pfTrueColorFlag')
        .getWord16be('pfRedMax')
        .getWord16be('pfGreenMax')
        .getWord16be('pfBlueMax')
        .getWord8('pfRedShift')
        .getWord8('pfGreenShift')
        .getWord8('pfBlueShift')
        .skip(3)
        .getWord32be('nameLength')
        .getBuffer('nameString', 'nameLength')
        .tap(function (vars) {
            rfb.bufferMsg(
                Word8(clientMsgTypes.fbUpdate),
                Word8(1),
                Word16be(0),
                Word16be(0),
                Word16be(vars.fbWidth),
                Word16be(vars.fbHeight)
            );
            rfb.sendBuffer();
        })
        .flush()
        .forever(function (vars) {
            this
                .getWord8('serverMsgType')
                .when('serverMsgType', serverMsgTypes.fbUpdate, function (vars) {
                    this
                        .skip(1)
                        .getWord16be('nRects')
                        .repeat('nRects', function (vars, i) {
                            this
                                .getWord16be('x')
                                .getWord16be('y')
                                .getWord16be('w')
                                .getWord16be('h')
                                .getWord32be('encodingType')
                                .tap(function (vars) {
                                    vars.fbSize = vars.w*vars.h*vars.pfBitsPerPixel/8;
                                })
                                .getBuffer('fb', 'fbSize')
                                .tap(function (vars) {
                                    rfb.emit('raw', {
                                        fb : vars.fb,
                                        width : vars.w,
                                        height : vars.h,
                                        x : vars.x,
                                        y : vars.y,
                                    });
                                })
                                .flush()
                            ;
                        })
                    ;
                })
                /*
                .when('serverMsgType', serverMsgTypes.setColorMap, function (vars) {
                    this
                        .tap(function (vars) { sys.log('setColorMap not implemented yet') })
                })
                .when('serverMsgType', serverMsgTypes.bell, function (vars) {
                    this
                        .tap(function (vars) { sys.log('bell not implemented yet') })
                })
                .when('serverMsgType', serverMsgTypes.cutText, function (vars) {
                    this
                        .tap(function (vars) { sys.log('cutText not implemented yet') })
                })
                */
            ;
        })
        .end()
    ;
}

