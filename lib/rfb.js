// rfb client module
// http://www.realvnc.com/docs/rfbproto.pdf

var sys = require('sys');
var net = require('net');

var Buffer = require('buffer').Buffer;
var EventEmitter = require('events').EventEmitter;

var BufferList = require('bufferlist').BufferList;
var Binary = require('bufferlist/binary').Binary;
var Put = require('put');

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

module.exports = RFB;
RFB.prototype = new EventEmitter;
RFB.RFB = RFB;
function RFB(opts) {
    var self = this;
    if (typeof(opts) == 'undefined') opts = {};
    
    self.host = opts.host || 'localhost';
    self.port = opts.port || 5900;
    self.shared = opts.shared || false;
    self.engine = opts.engine || 'qemu';
    self.securityType = opts.securityType || 'none';
    
    // buffer up requests for the size until it's available
    var size = null;
    var dimQueue = []; // store callbacks
    
    self.__defineGetter__('dimensions', function () {
        return function (f) {
            if (size == null) dimQueue.push(f)
            else f(size);
        }
    });
    
    self.__defineSetter__('dimensions', function (dims) {
        var s = { width : dims.width, height : dims.height };
        if (size == null) dimQueue.forEach(function (f) { f(s) });
        size = s;
    });
    
    var stream = new net.Stream;
    
    var bufferList = new BufferList;
    var parser = new Parser(self, bufferList);
    
    sys.pump(stream, bufferList);
    
    stream.setNoDelay();
    stream.connect(self.port, self.host);
    
    stream.on('error', function (err) {
        self.emit('error', err);
    });
    
    stream.on('end', function () {
        self.emit('end');
        self.write = function (buf) {
            console.warn("Didn't write bytes to closed stream");
        };
    });
    
    self.write = function (buf) {
        if (buf instanceof Buffer) {
            stream.write(buf);
        }
        else {
            stream.write(buf, 'binary');
        }
        return self;
    };
    
    self.send = self.write.bind(self); // deprecated
    
    self.end = function () {
        stream.end();
        return self;
    };
    
    self.sendKey = function (key, down) {
        Put()
            .word8(clientMsgTypes.keyEvent)
            .word8(!!down)
            .pad(2)
            .word32be(key)
            .write(self)
        ;
        return self;
    };
    
    self.sendKeyDown = function (key) {
        return self.sendKey(key, 1);
    };
    
    self.sendKeyUp = function (key) {
        return self.sendKey(key, 0);
    };
    
    self.sendPointer = function (x, y, mask) {
        Put()
            .word8(clientMsgTypes.pointerEvent)
            .word8(mask)
            .word16be(x)
            .word16be(y)
            .write(self)
        ;
        return self;
    };
    
    self.requestUpdate = function (params) {
        Put()
            .word8(clientMsgTypes.fbUpdate)
            .word8(params.subscribe)
            .word16be(params.x)
            .word16be(params.y)
            .word16be(params.width)
            .word16be(params.height)
            .write(self)
        ;
    };
     
    self.requestRedraw = function () {
        self.dimensions(function (dims) {
            self.requestUpdate({
                x : 0,
                y : 0,
                width : dims.width,
                height : dims.height,
                subscribe : 0,
            });
        });
    };
    
    self.subscribe = function (params) {
        self.requestUpdate({
            x : params.x,
            y : params.y,
            width : params.width,
            height: params.height,
            subscribe : 1,
        });
    };

    self.pointer = function (x, y, mask) {
        Put()
            .word8(5)
            .word8(mask)
            .word16be(x)
            .word16be(y)
            .write(self)
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
                rfb.write('RFB 003.008\n');
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
            Put().word8(secNum).write(rfb);
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
            Put().word8(rfb.shared).write(rfb);
        })
        .into('size', function () {
            this
            .getWord16be('width')
            .getWord16be('height')
            .tap(function (size) { rfb.dimensions = size })
        })
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
            .tap(function (pf) {
                var bpp = depth = 24;
                if (rfb.engine == 'tightvnc') {
                    bpp = 32;
                    depth = 32;
                }
                // override server values
                pf.bitsPerPixel = bpp;
                pf.depth = depth;
                pf.bigEndian = 0;
                pf.trueColor = 1;
                pf.redMax = 0xFF;
                pf.greenMax = 0xFF;
                pf.blueMax = 0xFF;
                pf.redShift = 16;
                pf.greenShift = 8;
                pf.blueShift = 0;
            })
        })
        .skip(3)
        .getWord32be('nameLength')
        .getBuffer('nameString', 'nameLength')
        .tap(function (vars) {
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
                .write(rfb)
            ;
            
            Put()
                .word8(clientMsgTypes.setEncodings)
                .pad(1)
                .word16be(3) // number of encodings following
                .word32be(encodings.pseudoDesktopSize)
                .word32be(encodings.copyRect)
                .word32be(encodings.raw)
                .write(rfb)
            ;

            // send {left-,right-}{ctrl,alt,shift}
            [0xffe3, 0xffe4, 0xffe9, 0xffea, 0xffe1, 0xffe2].forEach(
                function (key) {
                    rfb.sendKeyDown(key);
                    rfb.sendKeyUp(key);
                }
            );
        })
        .tap(function (vars) {
            if (rfb.engine == 'vmware') {
                rfb.requestRedraw();
            }
            else {
                rfb.dimensions(function (dims) {
                    rfb.subscribe({
                        x : 0,
                        y : 0,
                        width : dims.width,
                        height : dims.height,
                    });
                });
            }
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
                    var nRects = vars.nRects;
                    var bpp = vars.pf.bitsPerPixel / 8;
                    
                    this.into('rect', function (rect) {
                        rect.nRects = nRects;
                        rect.type = 'unknownRect';
                        rect.index = i;
                        
                        this
                        .getWord16be('x')
                        .getWord16be('y')
                        .getWord16be('width')
                        .getWord16be('height')
                        .getWord32bes('encodingType')
                        .when('encodingType', encodings.raw, function (rect) {
                            this
                            .tap(function (rect) { rect.type = 'raw' })
                            .into('fbSize', rect.width * rect.height * bpp)
                            .getBuffer('fb','fbSize')
                        })
                        .when('encodingType', encodings.copyRect, function (rect) {
                            rect.type = 'copyRect';
                            this.getWord16be('srcX').getWord16be('srcY');
                        })
                        .when('encodingType', encodings.pseudoDesktopSize, function (rect) {
                            rfb.dimensions = {
                                width : rect.width,
                                height : rect.height,
                            };
                            rect.type = 'desktopSize';
                        })
                        .tap(function (rect) {
                            rfb.emit(rect.type, rect);
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
            .tap(function (vars) {
                if (rfb.engine == 'vmware') rfb.dimensions(function (dims) {
                    rfb.subscribe({
                        x : 0, y : 0,
                        width : dims.width, height : dims.height,
                    })
                });
            });
        })
        .end()
    ;
}

