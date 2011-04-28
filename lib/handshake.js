var exports = module.exports = function (rfb, opts) {
    [ 'version', 'security', 'init' ].forEach((function (x) {
        exports[x].call(this, rfb, opts);
    }).bind(this));
};

exports.version = function (rfb, opts) {
    this
    .buffer('prelude', 12)
    .tap(function (vars) {
        var m = vars.prelude.toString().match(/^RFB (\d{3}\.\d{3})/);
        if (!m) {
            rfb.emit('error', new Error(
                "Couldn't parse version handshake: " + vars.prelude
            ));
        }
        else {
            var version = Number(m[1]);
            if (version < 3.008) {
                rfb.emit('error', new Error(
                    'Remote version ' + version + ' < 3.008'
                ));
            }
            else {
                rfb.write('RFB 003.008\n');
                rfb.emit('version', version);
            }
        }
    })
};

exports.security = function (rfb, opts) {
    this
    .word8('secLen')
    .tap(function (vars) {
        if (vars.secLen === 0) {
            this
            .word8('msgLen')
            .buffer('msg','msgLen')
            .tap(function (vars) {
                rfb.emit('error', new Error(
                    'Server returned error in security handshake: '
                    + vars.msg.toString()
                ));
            })
        }
    })
    .buffer('secTypes', 'secLen')
    .tap(function (vars) {
        var secTypes = [].slice.call(vars.secTypes);
        var names = { 1 : 'none', 2 : 'vnc' };
        vars.secNum = { 'none' : 1, 'vnc' : 2 }[opts.securityType];
        
        rfb.emit('security', secTypes.map(
            function (t) { return names[t] }
        ));
        
        if (secTypes.indexOf(vars.secNum) < 0) {
            rfb.emit('error', new Error(
                'Security type ' + rfb.securityType + ' not supported'
            ));
        }
        
        Put().word8(vars.secNum).write(rfb.stream);
    })
    .tap(function (vars) {
        if (vars.secNum === 2) {
            this
            .buffer('challenge', 16)
            .tap(function (vars) {
                var response = des.encrypt(rfb.password, vars.challenge);
                Put().put(response).write(rfb);
            })
        }
    })
    .word32be('secRes')
    .tap(function (vars) {
        if (vars.secRes !== 0) {
            this
            .word32be('msgLen')
            .buffer('msg', 'msgLen')
            .tap(function (vars) {
                sys.log('Security handshake failed with message: '
                    + vars.msg.toString()
                );
            });
        }
    })
};

exports.init = function (rfb, opts) {
    this
    .tap(function (vars) {
        Put().word8(opts.shared).write(rfb.stream);
    })
    .into('size', function () {
        this
        .word16be('width')
        .word16be('height')
        .tap(function (size) { rfb.dimensions = size })
    })
    .into('pf', function () {
        this
        .word8('bitsPerPixel')
        .word8('depth')
        .word8('bigEndian')
        .word8('trueColor')
        .word16be('redMax')
        .word16be('greenMax')
        .word16be('blueMax')
        .word8('redShift')
        .word8('greenShift')
        .word8('blueShift')
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
    .word32be('nameLength')
    .buffer('nameString', 'nameLength')
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
};
