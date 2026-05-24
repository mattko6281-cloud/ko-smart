// =============================================
// TikZJax 폰트 로컬 다운로드 스크립트
// 실행: node download-tikzjax-fonts.js
// =============================================
const https = require('https');
const fs = require('fs');
const path = require('path');

const FONTS_CSS_URL = 'https://tikzjax.com/v1/fonts.css';
const FONT_BASE_URL = 'https://tikzjax.com/bakoma/ttf/';
const OUTPUT_DIR = path.join(__dirname, 'public', 'tikzjax');
const FONTS_DIR = path.join(OUTPUT_DIR, 'fonts');

fs.mkdirSync(FONTS_DIR, { recursive: true });

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function downloadFile(url, dest) {
  const data = await get(url);
  fs.writeFileSync(dest, data);
}

async function main() {
  console.log('📥 fonts.css 다운로드 중...');
  const cssBuffer = await get(FONTS_CSS_URL);
  const cssContent = cssBuffer.toString('utf8');

  // 모든 ttf 파일명 추출 (중복 제거)
  const fontFiles = [...new Set((cssContent.match(/[\w-]+\.ttf/g) || []))];
  console.log(`🔠 폰트 파일 ${fontFiles.length}개 발견\n`);

  // 로컬 경로로 수정한 fonts.css 저장
  const localCss = cssContent.replace(/url\('\.\.\/bakona\/ttf\//g, "url('/tikzjax/fonts/");
  fs.writeFileSync(path.join(OUTPUT_DIR, 'fonts.css'), localCss, 'utf8');
  console.log('✅ 로컬 fonts.css 생성 완료\n');

  // 각 폰트 파일 다운로드
  let success = 0, fail = 0;
  for (let i = 0; i < fontFiles.length; i++) {
    const fontFile = fontFiles[i];
    const dest = path.join(FONTS_DIR, fontFile);
    const url = FONT_BASE_URL + fontFile;
    process.stdout.write(`[${i + 1}/${fontFiles.length}] ${fontFile} ... `);
    try {
      await downloadFile(url, dest);
      process.stdout.write('✅\n');
      success++;
    } catch (err) {
      process.stdout.write(`❌ (${err.message})\n`);
      fail++;
    }
  }

  console.log(`\n==============================`);
  console.log(`완료: 성공 ${success}개 / 실패 ${fail}개`);
  if (fail === 0) {
    console.log('🎉 모든 폰트 다운로드 성공! 이제 npm run dev를 재시작하세요.');
  } else {
    console.log('⚠️ 일부 파일 실패. 재시도해보세요.');
  }
}

main().catch(e => { console.error('오류:', e); process.exit(1); });
