// 실행 전에 .env와 Gemini API 키를 확인한다. 키가 비어 있으면 터미널에서 한 번 물어보고 .env에 저장.
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

if (!fs.existsSync(envPath)) fs.copyFileSync(examplePath, envPath);
let env = fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '');

const m = env.match(/^GEMINI_API_KEY=(.*)$/m);
if (m && m[1].trim()) {
  console.log('[같이가게] Gemini API 키 확인 완료');
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('[같이가게] Gemini API 키가 아직 없어요.');
console.log('           키를 붙여넣고 Enter를 눌러 주세요. (검은 창에서는 마우스 오른쪽 클릭 = 붙여넣기)');
console.log('           비워 두고 Enter를 누르면 데모 모드로 실행돼요.');
rl.question('API 키: ', (answer) => {
  rl.close();
  const key = answer.trim();
  if (!key) {
    console.log('[같이가게] 키 없이 데모 모드로 실행합니다.');
    process.exit(0);
  }
  if (/^GEMINI_API_KEY=.*$/m.test(env)) env = env.replace(/^GEMINI_API_KEY=.*$/m, `GEMINI_API_KEY=${key}`);
  else env += `\nGEMINI_API_KEY=${key}\n`;
  fs.writeFileSync(envPath, env);
  console.log('[같이가게] .env 파일에 키를 저장했어요.');
});
