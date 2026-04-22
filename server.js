const http = require('http');
const https = require('https');
const fs = require('fs');
const url = require('url');
const path = require('path');

// ─── .env 수동 파싱 (외부 라이브러리 없이) ─────────────────────────────
function loadEnv() {
  try {
    const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
    envFile.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const [key, ...rest] = trimmed.split('=');
      if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
    });
  } catch (e) {
    console.warn('⚠️  .env 파일을 찾을 수 없습니다. 환경변수를 직접 설정해주세요.');
  }
}
loadEnv();

const CLIENT_ID     = process.env.NAVER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const PORT          = process.env.PORT || 3000;

// ─── 상품명 분석 함수 ─────────────────────────────────────────────────────
function analyzeProduct(name) {
  const result = {
    original: name,
    keywords: [],     // 네이버 검색에 쓸 핵심 키워드
    ticketType: null, // 1일권 / 1.5일권 / 2일권 등
    target: null,     // 성인 / 소인 / 시니어
    season: null,     // A~E시즌
    isInstant: false, // 즉시확정 여부
    extras: [],       // 추가 포함 항목
    destination: null // 목적지
  };

  // 즉시확정
  if (/즉시\s*확정/i.test(name)) result.isInstant = true;

  // 티켓 종류
  const ticketMatch = name.match(/(\d+\.?\d*)\s*일\s*권?/);
  if (ticketMatch) result.ticketType = ticketMatch[0].replace(/\s/g, '');
  else if (/입장권|자유이용권/i.test(name)) result.ticketType = '입장권';

  // 대상
  if (/성인/i.test(name)) result.target = '성인';
  else if (/소인|아동|어린이/i.test(name)) result.target = '소인';
  else if (/시니어|노인/i.test(name)) result.target = '시니어';

  // 시즌
  const seasonMatch = name.match(/([A-Fa-f])\s*시즌/i);
  if (seasonMatch) result.season = seasonMatch[1].toUpperCase() + '시즌';

  // 추가 포함
  if (/익스프레스/i.test(name)) result.extras.push('익스프레스패스');
  if (/닌텐도/i.test(name)) result.extras.push('닌텐도월드확약권');
  if (/간사이\s*조이/i.test(name)) result.extras.push('간사이조이패스');

  // 목적지 추출 (괄호, # 이후, 특수문자 제거)
  const cleaned = name
    .replace(/\[.*?\]/g, '')   // [즉시확정] 등 제거
    .replace(/#.*/g, '')        // #해시태그 제거
    .replace(/[^\w\s가-힣]/g, ' ')
    .trim();

  // 핵심 여행지 키워드 추출
  const destinations = [
    'USJ', '유니버셜', '유니버설', '디즈니', '도쿄', '오사카', '교토',
    '후쿠오카', '삿포로', '나고야', '제주', '방콕', '파리', '발리',
    '싱가포르', '홍콩', '뉴욕', '런던', '로마', '바르셀로나'
  ];
  for (const dest of destinations) {
    if (name.includes(dest)) {
      result.destination = dest;
      break;
    }
  }

  // 검색 키워드 조합
  const parts = [];
  if (result.destination) parts.push(result.destination);

  // 상품명의 핵심 부분 (앞 30자 내외, 정제)
  const core = cleaned.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (core) parts.push(core);

  if (result.ticketType) parts.push(result.ticketType);
  if (result.target) parts.push(result.target);
  if (result.season) parts.push(result.season);

  result.keywords = [...new Set(parts)];

  return result;
}

// ─── 유사도 계산 ─────────────────────────────────────────────────────────
function calcSimilarity(base, _item, itemTitle) {
  let score = 0;
  let maxScore = 0;
  const title = itemTitle.toLowerCase();

  // 티켓 타입 (30점, 필수 조건)
  if (base.ticketType) {
    maxScore += 30;
    if (base.ticketType === '입장권') {
      if (/입장권|자유이용권/.test(title)) score += 30;
    } else {
      if (title.includes(base.ticketType.replace('권', ''))) score += 30;
    }
  }

  // 대상 (25점, 필수 조건)
  if (base.target) {
    maxScore += 25;
    if (title.includes(base.target)) score += 25;
  }

  // 시즌 (25점, 필수 조건)
  if (base.season) {
    maxScore += 25;
    if (title.includes(base.season.toLowerCase())) score += 25;
  }

  // 추가 항목 (5점씩, 필수 조건)
  base.extras.forEach(ex => {
    maxScore += 5;
    if (title.includes(ex.slice(0, 3))) score += 5;
  });

  // 즉시확정은 보너스 (maxScore 미포함)
  if (base.isInstant && /즉시\s*확정/.test(title)) score += 10;

  // 패널티: 원본에 없는 추가 옵션이 결과에 포함된 경우
  if (!base.extras.some(e => e.includes('닌텐도')) && /닌텐도/.test(title)) score -= 30;
  if (!base.extras.some(e => e.includes('익스프레스')) && /익스프레스/.test(title)) score -= 20;
  if (base.ticketType === '입장권' && /프리패스/.test(title)) score -= 20;

  if (maxScore === 0) return { grade: '🔴', label: '참고 상품', score };

  const ratio = score / maxScore;
  if (score > 0 && ratio >= 0.8) return { grade: '🟢', label: '동일 상품', score };
  if (score > 0 && ratio >= 0.4) return { grade: '🟡', label: '유사 상품', score };
  return { grade: '🔴', label: '참고 상품', score };
}

// ─── 네이버 쇼핑 API 호출 ─────────────────────────────────────────────────
function naverSearch(query, display = 10) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(query);
    const options = {
      hostname: 'openapi.naver.com',
      path: `/v1/search/shop.json?query=${encoded}&display=${display}&sort=sim`,
      method: 'GET',
      headers: {
        'X-Naver-Client-Id': CLIENT_ID,
        'X-Naver-Client-Secret': CLIENT_SECRET,
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('API 응답 파싱 실패')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── HTTP 서버 ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const json = (data, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  // ── GET / → index.html ──
  if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('index.html 없음'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // ── GET /api/compare?q=상품명 ──
  if (parsed.pathname === '/api/compare') {
    const q = parsed.query.q;
    const hanatourPrice = parsed.query.hanatourPrice ? parseInt(parsed.query.hanatourPrice) : null;
    if (!q) return json({ error: '상품명을 입력해주세요.' }, 400);
    if (!CLIENT_ID || CLIENT_ID.includes('여기에')) {
      return json({ error: '.env 파일에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET을 입력해주세요.' }, 500);
    }

    try {
      // 상품 분석
      const analyzed = analyzeProduct(q);

      // 검색어 조합 (핵심 키워드)
      const searchQuery = analyzed.keywords.slice(0, 4).join(' ');

      // 네이버 쇼핑 검색
      const naverResult = await naverSearch(searchQuery, 15);

      if (!naverResult.items || naverResult.items.length === 0) {
        return json({ analyzed, items: [], message: '검색 결과가 없습니다.' });
      }

      // 각 상품 유사도 분석
      const items = naverResult.items
        .filter(item => parseInt(item.lprice) > 0)
        .map(item => {
          const cleanTitle = item.title.replace(/<[^>]+>/g, '');
          const sim = calcSimilarity(analyzed, item, cleanTitle);
          return {
            title: cleanTitle,
            mall: item.mallName,
            price: parseInt(item.lprice),
            link: item.link,
            image: item.image,
            similarity: sim,
          };
        })
        .sort((a, b) => {
          // 동일>유사>참고 순, 같은 등급이면 가격 낮은 순
          const gradeOrder = { '🟢': 0, '🟡': 1, '🔴': 2 };
          const gDiff = gradeOrder[a.similarity.grade] - gradeOrder[b.similarity.grade];
          return gDiff !== 0 ? gDiff : a.price - b.price;
        });

      // 최저/최고가 계산 (동일 상품 기준)
      const sameItems = items.filter(i => i.similarity.grade === '🟢');
      const minPrice = sameItems.length ? Math.min(...sameItems.map(i => i.price)) : null;
      const maxPrice = sameItems.length ? Math.max(...sameItems.map(i => i.price)) : null;

      json({ analyzed, searchQuery, items, stats: { minPrice, maxPrice, total: items.length, hanatourPrice } });

    } catch (err) {
      json({ error: 'API 오류: ' + err.message }, 500);
    }
    return;
  }

  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`\n✅  서버 실행 중 → http://localhost:${PORT}`);
  if (!CLIENT_ID || CLIENT_ID.includes('여기에')) {
    console.log('⚠️  .env 파일에 네이버 API 키를 입력해주세요!\n');
  } else {
    console.log('🔑  네이버 API 키 확인됨\n');
  }
});
