# Spec — 여행상품 가격비교 도구

## 아키텍처

```
브라우저 (index.html)
    ↕ fetch /api/compare?q=...&hanatourPrice=...
Node.js HTTP 서버 (server.js)
    ↕ HTTPS
네이버 쇼핑 API
```

외부 npm 패키지 없음. Node.js 내장 모듈(`http`, `https`, `fs`, `url`, `path`)만 사용.

---

## 파일 구성

| 파일 | 역할 |
|---|---|
| `server.js` | HTTP 서버, 상품 분석, API 호출, 유사도 계산 |
| `index.html` | 단일 파일 프론트엔드 (CSS + JS 인라인) |
| `.env` | 네이버 API 키 (NAVER_CLIENT_ID, NAVER_CLIENT_SECRET) |
| `prd.md` | 제품 요구사항 문서 |
| `spec.md` | 기술 명세 문서 (현재 파일) |

---

## API 엔드포인트

### `GET /api/compare`

**쿼리 파라미터**

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `q` | Y | 하나투어 상품명 (URL 인코딩) |
| `hanatourPrice` | N | 하나투어 판매가 (정수, 원 단위) |

**응답 JSON**

```json
{
  "analyzed": {
    "original": "원본 상품명",
    "keywords": ["유니버셜", "오사카 유니버셜스튜디오 재팬 입장권 티켓", "입장권"],
    "ticketType": "입장권",
    "target": null,
    "season": null,
    "isInstant": true,
    "extras": [],
    "destination": "유니버셜"
  },
  "searchQuery": "유니버셜 오사카 유니버셜스튜디오 재팬 입장권 티켓 입장권",
  "items": [
    {
      "title": "상품명",
      "mall": "쇼핑몰명",
      "price": 89000,
      "link": "https://...",
      "image": "https://...",
      "similarity": {
        "grade": "🟢",
        "label": "동일 상품",
        "score": 40
      }
    }
  ],
  "stats": {
    "minPrice": 85000,
    "maxPrice": 95000,
    "total": 12,
    "hanatourPrice": 89000
  }
}
```

---

## 핵심 함수 명세

### `analyzeProduct(name: string)`

상품명에서 속성을 추출해 구조화된 객체를 반환한다.

**추출 규칙**

| 속성 | 패턴 | 예시 |
|---|---|---|
| `isInstant` | `/즉시\s*확정/i` | `[즉시확정]` |
| `ticketType` | `/(\d+\.?\d*)\s*일\s*권?/` 우선, 없으면 `/입장권\|자유이용권/i` | `1일권`, `입장권` |
| `target` | `성인` / `소인\|아동\|어린이` / `시니어\|노인` | `성인` |
| `season` | `/([A-Fa-f])\s*시즌/i` | `A시즌` |
| `extras` | 익스프레스 / 닌텐도 / 간사이 조이 | `익스프레스패스` |
| `destination` | 고정 목록 순차 매칭 | `유니버셜` |

**검색 키워드 조합 순서**: `destination` → `core(정제된 상품명 앞 40자)` → `ticketType` → `target` → `season`

---

### `calcSimilarity(base, _item, itemTitle)`

지정 조건 기반 비율 채점으로 등급을 결정한다.

**채점표**

| 조건 | 점수 | maxScore 포함 |
|---|---|---|
| ticketType 일치 | +30 | Y |
| target 일치 | +25 | Y |
| season 일치 | +25 | Y |
| extras 항목별 일치 | +5 | Y |
| isInstant 일치 | +10 | N (보너스) |

**패널티** (원본에 해당 extras가 없을 때)

| 조건 | 감점 |
|---|---|
| 결과에 "닌텐도" 포함 | -30 |
| 결과에 "익스프레스" 포함 | -20 |
| ticketType이 "입장권"인데 결과에 "프리패스" 포함 | -20 |

**등급 기준**

```
ratio = score / maxScore

maxScore == 0          → 🔴 참고 상품
score > 0, ratio >= 0.8 → 🟢 동일 상품
score > 0, ratio >= 0.4 → 🟡 유사 상품
그 외                   → 🔴 참고 상품
```

---

### `naverSearch(query: string, display: number)`

네이버 쇼핑 API를 호출해 결과를 반환한다.

- 엔드포인트: `https://openapi.naver.com/v1/search/shop.json`
- 정렬: `sort=sim` (관련도순)
- 기본 결과 수: 15건
- 인증: `X-Naver-Client-Id`, `X-Naver-Client-Secret` 헤더

---

## 프론트엔드 동작 흐름

```
1. 사용자 입력
   - 하나투어 상품명 (필수)
   - 하나투어 판매가 (선택)

2. doSearch()
   - /api/compare?q=...&hanatourPrice=... 호출

3. renderAnalyzed(data.analyzed)
   - 추출 조건을 태그로 표시
   - ticketType: 초록, season: 노랑, isInstant: 빨강, extras: 회색

4. renderResults(data)
   - 통계 카드 (3개)
     - hanatourPrice 있음: 하나투어 판매가 / 타사 최저가 / 하나투어 대비
     - hanatourPrice 없음: 동일상품 최저가 / 최고가 / 가격 차이
   - 상품 카드 (등급별 구분선)
     - 가격 차이: 동일상품 최저가 대비 (+XX원 or 최저가 뱃지)
     - 하나투어 비교: ↓저렴(초록) / ↑비쌈(빨강) / =동일가(회색)
```

---

## 환경 설정

**.env 형식**

```
NAVER_CLIENT_ID=발급받은_클라이언트_ID
NAVER_CLIENT_SECRET=발급받은_클라이언트_시크릿
PORT=3000
```

**실행**

```bash
node server.js
# → http://localhost:3000
```

---

## 제약 사항

- 네이버 쇼핑 API 무료 쿼터: 25,000 req/일
- 검색어는 상품명에서 자동 생성되므로 수동 조정 불가
- 가격은 실시간 변동 — 결과는 조회 시점 기준
- 하나투어 상품 가격은 직접 입력 필요 (자동 수집 없음)
