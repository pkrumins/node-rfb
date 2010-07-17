// rfb client module
// http://www.realvnc.com/docs/rfbproto.pdf

var sys = require('sys');
var net = require('net');

var Buffer = require('buffer').Buffer;
var EventEmitter = require('events').EventEmitter;

var BufferList = require('bufferlist').BufferList;
var Binary = require('bufferlist/binary').Binary;
var Put = require('rfb/put').Put;

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
    hextile : 5,
    zrle : 16,
    pseudoCursor : -239,
    pseudoDesktopSize : -223
};

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
        Put()
            .word8(clientMsgTypes.keyEvent)
            .word8(!!down)
            .pad(2)
            .word32be(key)
            .send(this)
        ;
        return this;
    };
    
    this.sendKeyDown = function (key) {
        this.sendKey(key, 1);
        return this;
    };
    
    this.sendKeyUp = function (key) {
        this.sendKey(key, 0);
        return this;
    };
    
    this.sendPointer = function (x, y, mask) {
        Put()
            .word8(clientMsgTypes.pointerEvent)
            .word8(mask)
            .word16be(x)
            .word16be(y)
            .send(this)
        ;
        return this;
    };

    this.fbUpdateRequest = function (x, y, width, height, subscribe) {
        Put()
            .word8(clientMsgTypes.fbUpdate)
            .word8(subscribe)
            .word16be(x)
            .word16be(y)
            .word16be(width)
            .word16be(height)
            .send(this)
        ;
    };

    this.fbDims = function () {
        return this.fb;
    };

    this.requestRedrawScreen = function () {
        this.fbUpdateRequest(0, 0, this.fb.width, this.fb.height, 0);
    };

    this.subscribeToScreenUpdates = function (x, y, width, height) {
        this.fbUpdateRequest(x, y, width, height, 1);
    };

    this.pointer = function (x, y, mask) {
        Put()
            .word8(5)
            .word8(mask)
            .word16be(x)
            .word16be(y)
            .send(this)
        ;
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
            Put().word8(secNum).send(rfb);
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
            Put().word8(rfb.shared).send(rfb);
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

            vars.pf.bitsPerPixel = 24; // override server values
            vars.pf.depth = 24;
            vars.pf.bigEndian = 0;
            vars.pf.trueColor = 1;
            vars.pf.redMax = 0xFF;
            vars.pf.greenMax = 0xFF;
            vars.pf.blueMax = 0xFF;
            vars.pf.redShift = 16;
            vars.pf.greenShift = 8;
            vars.pf.blueShift = 0;

            Put() // tell the server the format we'd like to receive data in
                .word8(clientMsgTypes.setPixelFormat)
                .pad(3)
                .word8(vars.pf.bitsPerPixel)
                .word8(vars.pf.depth)
                .word8(vars.pf.bigEndian)
                .word8(vars.pf.trueColor)
                .word16be(vars.pf.redMax)
                .word16be(vars.pf.greenMax)
                .word16be(vars.pf.blueMax)
                .word8(vars.pf.redShift)
                .word8(vars.pf.greenShift)
                .word8(vars.pf.blueShift)
                .pad(3)
                .send(rfb)
            ;

            Put()
                .word8(clientMsgTypes.setEncodings)
                .pad(1)
                .word16be(3) // number of encodings following
                .word32be(encodings.pseudoDesktopSize)
                .word32be(encodings.copyRect)
                .word32be(encodings.raw)
                .send(rfb)
            ;
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
                            .tap(function (vars) { vars.emitter = 'copyRect' })
                            .getWord16be('srcX')
                            .getWord16be('srcY')
                        })
                        .when('encodingType', encodings.pseudoDesktopSize, function (vars) {
                            rfb.fb.width = vars.rect.width;
                            rfb.fb.height = vars.rect.height;
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

