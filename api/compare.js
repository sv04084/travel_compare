const https = require('https');

const CLIENT_ID     = process.env.NAVER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const GOOGLE_AI_KEY = process.env.GOOGLE_AI_API_KEY && !process.env.GOOGLE_AI_API_KEY.includes('여기에')
  ? process.env.GOOGLE_AI_API_KEY : null;

const AI_PROMPT = `여행 상품명에서 아래 세 가지 속성을 추출해 JSON으로 반환하세요.

isInstant: 즉시 이용/확정/사용/발권/예약 가능 여부 (boolean)
ticketType: 티켓 종류 (string 또는 null)
  - "익스프레스패스4" 처럼 숫자 포함 가능
  - "1일권", "2일권", "입장권", "이용권", "자유이용권", "라운지이용권" 등
  - 없으면 null
destination: 주요 목적지/장소 (string 또는 null)
  - 도시명, 공항명, 테마파크명 등 핵심 장소
  - 없으면 null

반드시 JSON만 출력하세요. 설명 없음.
예시: {"isInstant":true,"ticketType":"입장권","destination":"오사카 USJ"}`;

function geminiRequest(name) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: AI_PROMPT + '\n\n상품명: ' + name }] }],
    });
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1/models/gemini-2.5-flash:generateContent?key=${GOOGLE_AI_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(new Error('응답 파싱 실패')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function extractWithAI(name) {
  if (!GOOGLE_AI_KEY) return null;
  try {
    const { status, body } = await geminiRequest(name);
    if (status !== 200) {
      console.warn('AI 추출 실패, 정규식 사용: HTTP', status, body?.error?.message || '');
      return null;
    }
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isInstant:   typeof parsed.isInstant === 'boolean' ? parsed.isInstant : null,
      ticketType:  typeof parsed.ticketType === 'string' ? parsed.ticketType : null,
      destination: typeof parsed.destination === 'string' ? parsed.destination : null,
    };
  } catch (e) {
    console.warn('AI 추출 실패, 정규식 사용:', e.message);
    return null;
  }
}

async function analyzeProduct(name) {
  const result = {
    original: name,
    keywords: [],
    ticketType: null,
    target: null,
    season: null,
    isInstant: false,
    extras: [],
    destination: null
  };

  if (/즉시\s*(확정|사용|이용|발권|입장|예약)|바로\s*(사용|이용|입장)/i.test(name)) {
    result.isInstant = true;
  }

  const expressNumMatch = name.match(/익스프레스\s*패스\s*(\d+)/i);
  const dayTicketMatch  = name.match(/(\d+\.?\d*)\s*일\s*권?/);
  const genericMatch    = name.match(/[가-힣]{1,6}권|[가-힣]{1,5}패스/);
  if (expressNumMatch) {
    result.ticketType = `익스프레스패스${expressNumMatch[1]}`;
  } else if (dayTicketMatch) {
    result.ticketType = dayTicketMatch[0].replace(/\s/g, '');
  } else if (/익스프레스\s*패스/i.test(name)) {
    result.ticketType = '익스프레스패스';
  } else if (genericMatch) {
    result.ticketType = genericMatch[0];
  }

  if (/성인/i.test(name)) result.target = '성인';
  else if (/소인|아동|어린이/i.test(name)) result.target = '소인';
  else if (/시니어|노인/i.test(name)) result.target = '시니어';

  const seasonMatch = name.match(/([A-Fa-f])\s*시즌/i);
  if (seasonMatch) result.season = seasonMatch[1].toUpperCase() + '시즌';

  if (/닌텐도/i.test(name)) result.extras.push('닌텐도월드확약권');
  if (/간사이\s*조이/i.test(name)) result.extras.push('간사이조이패스');

  const cleaned = name
    .replace(/\[.*?\]/g, '')
    .replace(/#.*/g, '')
    .replace(/[^\w\s가-힣]/g, ' ')
    .trim();

  const destinations = [
    'USJ', '유니버셜', '유니버설', '디즈니', '도쿄', '오사카', '교토',
    '후쿠오카', '삿포로', '나고야', '방콕', '파리', '발리',
    '싱가포르', '홍콩', '뉴욕', '런던', '로마', '바르셀로나',
    '인천', '김포', '김해', '제주', '부산', '대구', '청주'
  ];
  for (const dest of destinations) {
    if (name.includes(dest)) { result.destination = dest; break; }
  }

  const ai = await extractWithAI(name);
  if (ai) {
    if (ai.isInstant !== null)   result.isInstant   = ai.isInstant;
    if (ai.ticketType)           result.ticketType  = ai.ticketType;
    if (ai.destination)          result.destination = ai.destination;
    result.aiUsed = true;
  }

  const parts = [];
  if (result.destination) parts.push(result.destination);

  const core = cleaned.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (core) parts.push(core);

  if (result.ticketType && !result.ticketType.startsWith('익스프레스패스')) {
    parts.push(result.ticketType);
  }
  if (result.target) parts.push(result.target);
  if (result.season) parts.push(result.season);

  result.keywords = [...new Set(parts)];
  return result;
}

function calcSimilarity(base, _item, itemTitle) {
  let score = 0;
  let maxScore = 0;
  const title = itemTitle.toLowerCase();

  if (base.ticketType) {
    maxScore += 30;
    if (base.ticketType === '입장권') {
      if (/입장권|자유이용권/.test(title)) score += 30;
    } else if (/^익스프레스패스(\d+)$/.test(base.ticketType)) {
      const num = base.ticketType.replace('익스프레스패스', '');
      if (new RegExp(`익스프레스\\s*패스\\s*${num}`).test(title)) score += 30;
      else if (/익스프레스\s*패스/.test(title)) score += 15;
    } else if (base.ticketType === '익스프레스패스') {
      if (/익스프레스\s*패스/.test(title)) score += 30;
    } else {
      if (/\d/.test(base.ticketType)) {
        if (title.includes(base.ticketType.replace('권', ''))) score += 30;
      } else {
        if (title.includes(base.ticketType)) score += 30;
      }
    }
  }

  if (base.target) {
    maxScore += 25;
    if (title.includes(base.target)) score += 25;
  }

  if (base.season) {
    maxScore += 25;
    if (title.includes(base.season.toLowerCase())) score += 25;
  }

  base.extras.forEach(ex => {
    maxScore += 5;
    if (title.includes(ex.slice(0, 3))) score += 5;
  });

  if (base.extraConditions && base.extraConditions.length) {
    base.extraConditions.forEach(cond => {
      maxScore += 5;
      if (title.includes(cond.toLowerCase())) score += 5;
    });
  }

  if (base.isInstant && /즉시\s*(확정|사용|이용|발권)|바로\s*(사용|이용)/.test(title)) score += 10;

  if (!base.extras.some(e => e.includes('닌텐도')) && /닌텐도/.test(title)) score -= 30;
  if (base.ticketType === '입장권' && /익스프레스/.test(title)) score -= 25;
  if (base.ticketType === '입장권' && /프리패스/.test(title)) score -= 20;

  if (maxScore === 0) return { grade: '🔴', label: '참고 상품', score };

  const ratio = score / maxScore;
  if (score > 0 && ratio >= 0.8) return { grade: '🟢', label: '동일 상품', score };
  if (score > 0 && ratio >= 0.4) return { grade: '🟡', label: '유사 상품', score };
  return { grade: '🔴', label: '참고 상품', score };
}

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const json = (data, code = 200) => res.status(code).json(data);

  const { q, hanatourPrice, extra } = req.query;
  const extraConditions = extra ? extra.split(',').map(s => s.trim()).filter(Boolean) : [];

  if (!q) return json({ error: '상품명을 입력해주세요.' }, 400);
  if (!CLIENT_ID || CLIENT_ID.includes('여기에')) {
    return json({ error: 'Vercel 환경변수에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET을 입력해주세요.' }, 500);
  }

  try {
    const analyzed = await analyzeProduct(q);
    analyzed.extraConditions = extraConditions;

    const searchQuery = [...analyzed.keywords, ...extraConditions].slice(0, 5).join(' ');
    const naverResult = await naverSearch(searchQuery, 15);

    if (!naverResult.items || naverResult.items.length === 0) {
      return json({ analyzed, items: [], message: '검색 결과가 없습니다.' });
    }

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
        const gradeOrder = { '🟢': 0, '🟡': 1, '🔴': 2 };
        const gDiff = gradeOrder[a.similarity.grade] - gradeOrder[b.similarity.grade];
        return gDiff !== 0 ? gDiff : a.price - b.price;
      });

    const sameItems = items.filter(i => i.similarity.grade === '🟢');
    const minPrice = sameItems.length ? Math.min(...sameItems.map(i => i.price)) : null;
    const maxPrice = sameItems.length ? Math.max(...sameItems.map(i => i.price)) : null;

    json({ analyzed, searchQuery, items, stats: { minPrice, maxPrice, total: items.length, hanatourPrice: hanatourPrice ? parseInt(hanatourPrice) : null } });

  } catch (err) {
    json({ error: 'API 오류: ' + err.message }, 500);
  }
};
