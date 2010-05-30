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
    setEncodings : 2,
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

var encodings = {
    raw : 0,
    copyRect : 1,
    rre : 2,
    hextile : 3,
    zrle : 16,
    pseudoCursor : -239,
    pseudoDesktopSize : -223
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
    
    rfb.fb = { width : null, height : null };
    
    var stream = new net.Stream;

    var bufferList = new BufferList;
    var parser = new Parser(rfb, bufferList);

    stream.addListener('data', function (data) {
        bufferList.push(data);
    });

    /*
    stream.addListener('error', function (exception) {
        rfb.emit('error', exception.message);
    });
    */
    
    stream.setNoDelay();
    stream.connect(rfb.port, rfb.host);
    
    this.send = function () {
        var bList = new BufferList;
        [].concat.apply([],arguments).forEach(function (arg) {
            if (arg instanceof Buffer) {
                bList.push(arg);
            }
            else {
                var buf = new Buffer(arg.length);
                buf.write(arg, 'binary');
                bList.push(buf);
            }
        });
        stream.write(bList.join());
        return this;
    };
    
    this.end = function () {
        stream.end();
        return this;
    };
    
    this.sendKey = function (key, down) {
        this.send(
            Word8(clientMsgTypes.keyEvent),
            Word8(!!down),
            Pad16(),
            Word32be(key)
        );
    };
    
    this.sendKeyDown = function (key) {
        this.sendKey(key, 1);
    };
    
    this.sendKeyUp = function (key) {
        this.sendKey(key, 0);
    };
    
    this.sendPointer = function (mask, x, y) {
        this.send(
            Word8(clientMsgTypes.pointerEvent),
            Word8(mask),
            Word16be(x),
            Word16be(y)
        );
    };

    this.fbUpdateRequest = function (x, y, width, height, subscribe) {
        this.send(
            Word8(clientMsgTypes.fbUpdate),
            Word8(subscribe),
            Word16be(x),
            Word16be(y),
            Word16be(width),
            Word16be(height)
        );
    };

    this.requestRedrawScreen = function () {
        this.fbUpdateRequest(0, 0, this.fb.width, this.fb.height);
    };

    this.subscribeToScreenUpdates = function (x, y, width, height) {
        this.fbUpdateRequest(x, y, width, height);
    };

    this.pointer = function (x, y, mask) {
        this.send(
            Word8(5),
            Word8(mask),
            Word16be(x),
            Word16be(y)
        );
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
        .getWord16be('fb.width')
        .getWord16be('fb.height')
        .into('pf', function () {
            this
            .getWord8('bitsPerPixel')
            .getWord8('depth')
            .getWord8('bigEndian')
            .getWord8('trueColor')
            .getWord16be('redMax')
            .getWord16be('greenMax')
            .getWord16be('blueMax')
            .getWord8('redShift')
            .getWord8('greenShift')
            .getWord8('blueShift')
        })
        .skip(3)
        .getWord32be('nameLength')
        .getBuffer('nameString', 'nameLength')
        .tap(function (vars) {
            rfb.fb.width = vars.fb.width;
            rfb.fb.height = vars.fb.height;

            vars.pf.bitsPerPixel = 32; // override server values
            vars.pf.depth = 24;
            vars.pf.bigEndian = 0;
            vars.pf.trueColor = 1;
            vars.pf.redMax = 0xFF;
            vars.pf.greenMax = 0xFF;
            vars.pf.blueMax = 0xFF;
            vars.pf.redShift = 16;
            vars.pf.greenShift = 8;
            vars.pf.blueShift = 0;

            rfb.send( // tell the server the format we'd like to receive data in
                Word8(clientMsgTypes.setPixelFormat),
                Pad24(),
                Word8(vars.pf.bitsPerPixel),
                Word8(vars.pf.depth),
                Word8(vars.pf.bigEndian),
                Word8(vars.pf.trueColor),
                Word16be(vars.pf.redMax),
                Word16be(vars.pf.greenMax),
                Word16be(vars.pf.blueMax),
                Word8(vars.pf.redShift),
                Word8(vars.pf.greenShift),
                Word8(vars.pf.blueShift),
                Pad24()
            );

            rfb.send( // tell the server our preferred encodings
                Word8(clientMsgTypes.setEncodings),
                Pad8(),
                Word16be(3), // number of encodings following
                Word32be(encodings.pseudoDesktopSize),
                Word32be(encodings.copyRect),
                Word32be(encodings.raw)
            );
        })
        .tap(function (vars) {
            rfb.subscribeToScreenUpdates(0, 0, vars.fb.width, vars.fb.Height)
        })
        .flush()
        .forever(function (vars) {
            this
            .getWord8('serverMsgType')
            .when('serverMsgType', serverMsgTypes.fbUpdate, function (vars) {
                this
                .skip(1)
                .getWord16be('nRects')
                .tap(function (vars) {
                    rfb.emit('startRects', vars.nRects);
                })
                .repeat('nRects', function (vars, i) {
                    this.into('rect', function () {
                        this
                        .tap(function (vars) { vars.emitter = 'unknownRect' })
                        .into('nRects',vars.nRects)
                        .into('index',i)
                        .getWord16be('x')
                        .getWord16be('y')
                        .getWord16be('width')
                        .getWord16be('height')
                        .getWord32bes('encodingType')
                        .when('encodingType', encodings.raw, function (vars) {
                            this
                            .tap(function (vars) { vars.emitter = 'raw' })
                            .into('fbSize', vars.rect.width * vars.rect.height
                                * vars.pf.bitsPerPixel / 8
                            )
                            .getBuffer('fb','fbSize')
                        })
                        .when('encodingType', encodings.copyRect, function (vars) {
                            this
                            .tap(function (vars) { sys.log('got copyRect'); })
                            .tap(function (vars) { vars.emitter = 'copyRect' })
                            .getWord16be('srcX')
                            .getWord16be('srcY')
                        })
                        .when('encodingType', encodings.pseudoDesktopSize, function (vars) {
                            this
                            .tap(function (vars) { vars.emitter = 'desktopSize' })
                        })
                        .tap(function (vars) {
                            rfb.emit(vars.emitter,vars.rect);
                        })
                    })
                    .flush();
                })
                .tap(function (vars) {
                    rfb.emit('endRects', vars.nRects);
                });
            })
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
            ;
        })
        .end()
    ;
}

