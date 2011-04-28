var exports = module.exports = function (rfb, opts) {
    var bs = this;
    
    bs.loop(function () {
        exports.message.call(this, rfb, opts)
    });
};

var constants = require('./constants');
var serverMsgTypes = constants.serverMsgTypes;
var encodings = constants.encodings;

exports.message = function (rfb, opts) {
    this
    .word8('serverMsgType')
    .tap(function (vars) {
        var handler = exports.serverMsg[vars.serverMsgType];
        if (!handler) {
            rfb.emit('error', new Error(
                'No handler for type ' + vars.serverMsgType
            ));
        }
        else {
            handler.call(this, rfb, opts);
        }
    })
};

exports.serverMsg = {};

exports.serverMsg[serverMsgTypes.setColorMap] = function (rfb, opts) {
    rfb.emit('error', 'setColorMap not implemented');
};
exports.serverMsg[serverMsgTypes.bell] = function (rfb, opts) {
    rfb.emit('error', 'bell not implemented');
};

exports.serverMsg[serverMsgTypes.cutText] = function (rfb, opts) {
    rfb.emit('error', 'cutText not implemented');
};

exports.serverMsg[serverMsgTypes.fbUpdate] = function (rfb, opts) {
    this
    .skip(1)
    .word16be('nRects')
    .tap(function (vars) {
        rfb.emit('startRects', vars.nRects);
        vars.i = 0;
    })
    .loop(function (end, vars) {
        if (vars.i >= vars.nRects) {
            rfb.emit('endRects', vars.nRects);
            end();
            return;
        }
        
        var bpp = vars.pf.bitsPerPixel / 8;
            
        this.into('rect', function (rect) {
            rect.nRects = vars.nRects;
            rect.type = 'unknownRect';
            rect.index = vars.i;
            
            this
            .word16be('x')
            .word16be('y')
            .word16be('width')
            .word16be('height')
            .word32bs('encodingType')
            .tap(function () {
                switch (rect.encodingType) {
                    case encodings.raw :
                        rect.type = 'raw';
                        rect.fbSize = rect.width * rect.height * bpp;
                        this.buffer('fb','fbSize');
                    break;
                    case encodings.copyRect :
                        rect.type = 'copyRect';
                        this
                        .word16be('srcX')
                        .word16be('srcY')
                    break;
                    case encodings.pseudoDesktopSize :
                        rfb.dimensions = {
                            width : rect.width,
                            height : rect.height,
                        };
                        rect.type = 'desktopSize';
                        
                        /*
                        rfb.subscribe({
                            x : 0, y : 0,
                            width : rect.width,
                            height : rect.height,
                        });
                        */
                    break;
                }
                
                rfb.emit(rect.type, rect);
            })
        })
    })
};
