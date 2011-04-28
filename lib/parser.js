var Binary = require('binary')

var handshake = require('./handshake');
var messages = require('./messages');

module.exports = function (rfb, opts) {
    var bs = Binary(rfb.stream);
    
    handshake.call(bs, rfb, opts);
    bs.loop(function () {
        messages.call(this, rfb, opts);
    });
};
