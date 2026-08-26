# PDF Problembook Cutter

두 단으로 구성된 원서 PDF에서 문제 경계를 직접 지정하고, 풀이 공간이 포함된 A4 문제집 PDF로 재배치하는 로컬 웹앱입니다. PDF 처리와 결과 생성은 브라우저 안에서 수행되며 원본 파일은 서버로 업로드되지 않습니다.

## 주요 기능

- 홀수·짝수 페이지별 좌우 여백 및 중앙 분할선 설정
- 페이지·좌우 단별 `Start`, `Continue`, `End` 문제 경계
- 여러 페이지에 걸친 문제 조각 연결
- 문제와 풀이 공간을 한 단위로 배치하여 단·페이지 경계에서 잘림 방지
- 풀이 공간 크기 조절 및 원서 정답 페이지 부록 첨부
- 경계 설정 JSON 저장·불러오기
- 마우스, 키보드, 모바일 터치 지원

## 로컬 실행

Node.js 22 이상이 필요합니다.

### Windows

`start-windows.bat`을 더블클릭한 뒤 터미널에 표시되는 주소를 브라우저에서 엽니다.

### macOS / Linux

```bash
chmod +x start-mac.command
./start-mac.command
```

### npm으로 직접 실행

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 4173
```

프로덕션 빌드는 `npm run build`로 확인할 수 있습니다.

## 사용 방법

1. `PDF 업로드`로 원서 PDF를 엽니다.
2. 문제 페이지 범위와 필요하면 정답 부록 범위를 입력합니다.
3. 홀수·짝수 페이지의 왼쪽, 중앙, 오른쪽 세로 경계를 맞춥니다.
4. 각 단에서 문제 경계를 지정합니다.
   - `Start` (`S`): 문제 시작
   - `Continue` (`C`): 현재 조각을 닫거나 다음 페이지에서 같은 문제를 재개
   - `End` (`E`): 문제 종료
5. 선을 드래그해 보정하고, 우클릭하거나 목록의 `×`로 삭제합니다.
6. 풀이 공간을 조절한 뒤 `문제집 PDF 생성`을 누릅니다.

연속된 `Start` 선은 같은 위치를 앞 문제의 끝과 다음 문제의 시작으로 사용합니다. 생성 시 문제와 풀이 공간 전체가 현재 단에 들어가지 않으면 오른쪽 단 또는 다음 페이지로 함께 이동합니다. 한 단보다 큰 문제는 비율을 유지한 채 단 안에 맞게 축소됩니다.

## GitHub 업로드 및 웹 배포

압축을 푼 폴더에서 다음과 같이 새 저장소를 만들 수 있습니다.

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <YOUR_REPOSITORY_URL>
git push -u origin main
```

`node_modules`, 빌드 결과물, 환경 변수 파일은 `.gitignore`에 포함되어 있습니다.

### Cloudflare Workers에 자동 배포

이 저장소에는 `.github/workflows/deploy-cloudflare.yml`이 포함되어 있습니다. 아래 설정을 한 번 마치면 `main` 브랜치에 push할 때마다 웹사이트가 자동 배포됩니다.

1. Cloudflare 대시보드에서 Workers 배포 권한이 있는 API Token을 생성합니다.
2. GitHub 저장소의 `Settings → Secrets and variables → Actions`로 이동합니다.
3. 다음 Repository secret 두 개를 추가합니다.
   - `CLOUDFLARE_API_TOKEN`: 생성한 API Token
   - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare Account ID
4. `Actions` 탭에서 `Deploy to Cloudflare Workers`를 실행하거나 `main`에 새 commit을 push합니다.
5. Actions 로그의 `workers.dev` 주소로 접속합니다.

GitHub Actions 없이 PC에서 직접 배포하려면 Cloudflare에 로그인한 뒤 다음 명령을 실행합니다.

```bash
npm install
npx wrangler login
npm run deploy:cloudflare
```

PDF는 사용자의 브라우저에서만 처리되므로 별도의 서버 저장소나 데이터베이스 설정은 필요하지 않습니다.

## 개인정보

PDF 읽기, 렌더링, 자르기 및 결과 PDF 생성은 모두 사용자의 브라우저 메모리 안에서 처리됩니다.
