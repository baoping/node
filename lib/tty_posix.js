
var binding = process.binding('stdio'),
    net = require('net'),
    inherits = require('util').inherits,
    spawn = require('child_process').spawn;


exports.open = function(path, args) {
  var fds = binding.openpty();

  var slaveFD = fds[0];
  var masterFD = fds[1];

  var env = { TERM: 'vt100' };
  for (var k in process.env) {
    env[k] = process.env[k];
  }

  var stream = require('net').Stream(slaveFD);
  stream.readable = stream.writable = true;
  stream.resume();


  child = spawn(path, args, {
    env: env,
    customFds: [masterFD, masterFD, masterFD],
    setuid: true
  });

  return [stream, child];
};


function ReadStream(fd) {
  if (!(this instanceof ReadStream)) return new ReadStream(fd);
  net.Socket.call(this, fd);

  var self = this,
      keypressListeners = this.listeners('keypress');

  function onData(b) {
    if (keypressListeners.length) {
      self._emitKey(b);
    } else {
      // Nobody's watching anyway
      self.removeListener('data', onData);
      self.on('newlistener', onNewListener);
    }
  }

  function onNewListener(event) {
    if (event == 'keypress') {
      self.on('data', onData);
      self.removeListener('newlistener', onNewListener);
    }
  }

  this.on('newListener', onNewListener);
}
inherits(ReadStream, net.Socket);
exports.ReadStream = ReadStream;

ReadStream.prototype.isTTY = true;

/*
  Some patterns seen in terminal key escape codes, derived from combos seen
  at http://www.midnight-commander.org/browser/lib/tty/key.c

  ESC [ letter
  ESC [ modifier letter
  ESC [ 1 ; modifier letter
  ESC [ num char
  ESC [ num ; modifier char
  ESC O letter
  ESC O modifier letter
  ESC O 1 ; modifier letter
  ESC N letter
  ESC [ [ num ; modifier char
  ESC [ [ 1 ; modifier letter
  ESC ESC [ num char
  ESC ESC O letter

  - char is usually ~ but $ and ^ also happen with rxvt
  - modifier is 1 +
                (shift     * 1) +
                (left_alt  * 2) +
                (ctrl      * 4) +
                (right_alt * 8)
  - two leading ESCs apparently mean the same as one leading ESC
*/

// Regex used for ansi escape code splitting
var splitKeyCodeRe =
  /^(?:\x1b+)(O|N|\[|\[\[)(?:(\d+)(?:;(\d+))?([~^$])|(?:1;(\d+))?([a-zA-Z]))/;

ReadStream.prototype._emitKey = function(s) {
  var char,
      key = {
        name: undefined,
        ctrl: false,
        meta: false,
        shift: false
      },
      parts;

  if (Buffer.isBuffer(s)) {
    s = s.toString(this.encoding || 'utf-8');
  }

  if (s === '\r') {
    // enter
    key.name = 'enter';

  } else if (s === '\t') {
    // tab
    key.tab = 'tab';

  } else if (s === '\b' || s === '\x7f') {
    // backspace or ctrl+h
    key.name = 'backspace';

  } else if (s === '\x1b') {
    // escape key
    key.name = 'escape';

  } else if (s === ' ') {
    key.name = 'space';

  } else if (s <= '\x1a') {
    // ctrl+letter
    key.name = String.fromCharCode(s.charCodeAt(0) + 'a'.charCodeAt(0) - 1);
    key.ctrl = true;

  } else if (s >= 'a' && s <= 'z') {
    // lowercase letter
    key.name = s;

  } else if (s >= 'A' && s <= 'Z') {
    // shift+letter
    key.name = s.toLowerCase();
    key.shift = true;

  } else if (parts = splitKeyCodeRe.exec(s)) {
    // ansi escape sequence

    // reassemble the key code leaving out leading \x1b's,
    // the modifier key bitflag and any meaningless "1;" sequence
    var code = (parts[1] || '') + (parts[2] || '') + 
               (parts[4] || '') + (parts[6] || ''),
        modifier = (parts[3] || parts[5] || 1) - 1;

    // Parse the key modifier
    key.ctrl = !!(modifier & 4);
    key.meta = !!(modifier & 10);
    key.shift = !!(modifier & 1);

    // Parse the key itself
    switch (code) {
      /* xterm/gnome ESC O letter */
      case 'OP': key.name = 'f1'; break;
      case 'OQ': key.name = 'f2'; break;
      case 'OR': key.name = 'f3'; break;
      case 'OS': key.name = 'f4'; break;

      /* xterm/rxvt ESC [ number ~ */
      case '[11~': key.name = 'f1'; break;
      case '[12~': key.name = 'f2'; break;
      case '[13~': key.name = 'f3'; break;
      case '[14~': key.name = 'f4'; break;

      /* common */
      case '[15~': key.name = 'f5'; break;
      case '[17~': key.name = 'f6'; break;
      case '[18~': key.name = 'f7'; break;
      case '[19~': key.name = 'f8'; break;
      case '[20~': key.name = 'f9'; break;
      case '[21~': key.name = 'f10'; break;
      case '[23~': key.name = 'f11'; break;
      case '[24~': key.name = 'f12'; break;

      /* xterm ESC [ letter */
      case '[A': key.name = 'up'; break;
      case '[B': key.name = 'down'; break;
      case '[C': key.name = 'right'; break;
      case '[D': key.name = 'left'; break;
      case '[E': key.name = 'clear'; break;
      case '[F': key.name = 'end'; break;
      case '[H': key.name = 'home'; break;

      /* xterm/gnome ESC O letter */
      case 'OA': key.name = 'up'; break;
      case 'OB': key.name = 'down'; break;
      case 'OC': key.name = 'right'; break;
      case 'OD': key.name = 'left'; break;
      case 'OE': key.name = 'clear'; break;
      case 'OF': key.name = 'end'; break;
      case 'OH': key.name = 'home'; break;

      /* xterm/rxvt ESC [ number ~ */
      case '[1~': key.name = 'home'; break;
      case '[2~': key.name = 'insert'; break;
      case '[3~': key.name = 'delete'; break;
      case '[4~': key.name = 'end'; break;
      case '[5~': key.name = 'pageup'; break;
      case '[6~': key.name = 'pagedown'; break;

      /* putty */
      case '[[5~': key.name = 'pageup'; break;
      case '[[6~': key.name = 'pagedown'; break;

      /* rxvt */
      case '[7~': key.name = 'home'; break;
      case '[8~': key.name = 'end'; break;

      /* rxvt keys with modifiers */
      case '[a': key.name = 'up'; key.shift = true; break;
      case '[b': key.name = 'down'; key.shift = true; break;
      case '[c': key.name = 'right'; key.shift = true; break;
      case '[d': key.name = 'left'; key.shift = true; break;
      case '[e': key.name = 'clear'; key.shift = true; break;

      case '[2$': key.name = 'insert'; key.shift = true; break;
      case '[3$': key.name = 'delete'; key.shift = true; break;
      case '[5$': key.name = 'pageup'; key.shift = true; break;
      case '[6$': key.name = 'pagedown'; key.shift = true; break;
      case '[7$': key.name = 'home'; key.shift = true; break;
      case '[8$': key.name = 'end'; key.shift = true; break;

      case 'Oa': key.name = 'up'; key.ctrl = true; break;
      case 'Ob': key.name = 'down'; key.ctrl = true; break;
      case 'Oc': key.name = 'right'; key.ctrl = true; break;
      case 'Od': key.name = 'left'; key.ctrl = true; break;
      case 'Oe': key.name = 'clear'; key.ctrl = true; break;

      case '[2^': key.name = 'insert'; key.ctrl = true; break;
      case '[3^': key.name = 'delete'; key.ctrl = true; break;
      case '[5^': key.name = 'pageup'; key.ctrl = true; break;
      case '[6^': key.name = 'pagedown'; key.ctrl = true; break;
      case '[7^': key.name = 'home'; key.ctrl = true; break;
      case '[8^': key.name = 'end'; key.ctrl = true; break;

      /* misc. */
      case '[Z': key.name = 'tab'; key.shift = true; break;
    }
  }

  // Don't emit a key if no name was found
  if (key.name === undefined) {
    key = undefined;
  }

  if (s.length === 1) {
    char = s;
  }

  if (key || char) {
    this.emit('keypress', char, key);
  }
};


function WriteStream(fd) {
  if (!(this instanceof WriteStream)) return new WriteStream(fd);
  net.Socket.call(this, fd);
}
inherits(WriteStream, net.Socket);
exports.WriteStream = WriteStream;

WriteStream.prototype.isTTY = true;

WriteStream.prototype.cursorTo = function(x, y) {
  if (typeof x !== 'number' && typeof y !== 'number')
    return;

  if (typeof x !== 'number')
    throw new Error("Can't set cursor row without also setting it's column");

  if (typeof x === 'number') {
    this.write('\x1b[' + (x + 1) + 'G');
  } else {
    this.write('\x1b[' + (y + 1) + ';' + (x + 1) + 'H');
  }
};

WriteStream.prototype.moveCursor = function(dx, dy) {
  if (dx < 0) {
    this.write('\x1b[' + (-dx) + 'D');
  } else if (dx > 0) {
    this.write('\x1b[' + dx + 'C');
  }

  if (dy < 0) {
    this.write('\x1b[' + (-dy) + 'A');
  } else if (dy > 0) {
    this.write('\x1b[' + dy + 'B');
  }
};

WriteStream.prototype.clearLine = function(dir) {
  if (dir < 0) {
    // to the beginning
    this.write('\x1b[1K');
  } else if (dir > 0) {
    // to the end
    this.write('\x1b[0K');
  } else {
    // entire line
    this.write('\x1b[2K');
  }
};
