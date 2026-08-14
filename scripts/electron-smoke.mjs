import { spawn } from 'node:child_process';

const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run start'] : ['run', 'start'];
const child = spawn(command, args, {
  cwd: process.cwd(),
  env: { ...process.env, KNOWLEDGE_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
let settled = false;

function finish(error) {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
  else child.kill('SIGTERM');
  if (error) {
    console.error(output.slice(-4000));
    process.exitCode = 1;
  } else {
    console.log('Electron smoke passed: startup -> IPC ping -> library/detail window controls -> close');
  }
}

child.stdout.on('data', (chunk) => {
  output += chunk;
  if (output.includes('smoke-passed')) finish();
});
child.stderr.on('data', (chunk) => { output += chunk; });
child.on('error', finish);
child.on('exit', (code) => { if (!settled) finish(new Error(`electron exited with ${code}`)); });
const timeout = setTimeout(() => finish(new Error('electron smoke timeout')), 60000);
