# 여행상품 가격비교 서비스

하나투어 상품명을 입력하면 네이버 쇼핑 API로 타사 유사 상품을 검색해 가격을 비교합니다.

## 📁 프로젝트 구조

```
travel-price-compare/
├── server.js          # Node.js 백엔드 (네이버 API 프록시)
├── index.html         # 프론트엔드 UI
├── .env               # API 키 설정 (직접 입력 필요)
├── .gitignore         # .env 제외
└── README.md
```

## ⚙️ 시작하기

### 1. 네이버 API 키 발급
1. https://developers.naver.com 접속 → 로그인
2. Application → 애플리케이션 등록
3. 사용 API: "검색" 선택
4. WEB 환경: http://localhost:3000 입력
5. Client ID, Client Secret 복사

### 2. .env 파일에 키 입력
```
NAVER_CLIENT_ID=여기에_Client_ID
NAVER_CLIENT_SECRET=여기에_Client_Secret
```

### 3. 실행
```bash
node server.js
```

### 4. 브라우저에서 열기
```
http://localhost:3000
```

## 🔍 사용 방법

1. 하나투어 상품명을 입력창에 붙여넣기
   - 예: `[즉시확정][일본] 오사카 유니버셜스튜디오 재팬 입장권 티켓`
2. 검색 버튼 클릭
3. 조건 분석 → 네이버 쇼핑 검색 → 가격 비교 결과 확인

## ⚠️ 참고사항

- 네이버 쇼핑 API는 하루 25,000건 무료
- 가격은 실시간으로 변동될 수 있음
- 시즌/대상이 상품명에 없으면 유사 상품으로 분류됨
