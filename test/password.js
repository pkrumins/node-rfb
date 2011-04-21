var assert = require('assert');
var qemu = require('./lib/qemu');

var q = qemu('-vnc', ':0,password', qemu.img, '-monitor', 'stdio');

q.stdin.write('change vnc password\n');
q.stdin.write('moo\n');

q.stdout.once('data', function (buf) {
    console.dir(buf.toString());
});
