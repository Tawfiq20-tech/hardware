const { SerialPort } = require('serialport');

const BAUD_A = 230400;
const BAUD_B = 115200;
const BAUD_C = 9600;

const tests = [
  { baud: BAUD_A, rts: true },
  { baud: BAUD_A, rts: false },
  { baud: BAUD_B, rts: false },
  { baud: BAUD_C, rts: false },
];

let i = 0;

function tryNext() {
  if (i >= tests.length) {
    console.log('ALL TESTS DONE — if no RESPONSE lines appeared, the board is not talking on any baud rate');
    process.exit();
  }
  const t = tests[i];
  console.log('=== Test ' + (i + 1) + '/' + tests.length + ': baud=' + t.baud + ' rtscts=' + t.rts + ' ===');

  try {
    const p = new SerialPort({ path: 'COM3', baudRate: t.baud, rtscts: t.rts });

    p.on('open', function() {
      console.log('  PORT OPEN - sending probe commands...');
      p.write('D\n');
      p.write('r\n');
      p.write('\n');
      p.write('$I\n');
      p.write('?\n');
    });

    p.on('data', function(d) {
      console.log('  >>> RESPONSE: [' + d.toString('hex') + '] | ' + d.toString().trim());
    });

    p.on('error', function(e) {
      console.log('  ERROR: ' + e.message);
    });

    setTimeout(function() {
      try {
        p.close(function() {
          console.log('  PORT CLOSED');
          i++;
          setTimeout(tryNext, 1500);
        });
      } catch(e) {
        i++;
        setTimeout(tryNext, 1500);
      }
    }, 5000);

  } catch(e) {
    console.log('  FAILED TO OPEN: ' + e.message);
    i++;
    setTimeout(tryNext, 1500);
  }
}

console.log('Serial Port Diagnostic Tool');
console.log('Testing COM3 with multiple baud rates...');
console.log('');
tryNext();
