# GitHub Pages + Google Spreadsheet 연결 방식

Apps Script 단독 웹앱은 폐기하고, 아래 구조로 운영한다.

```text
GitHub Pages
  -> app.js JSONP 호출
  -> Apps Script API
  -> Google Spreadsheet 읽기/쓰기
```

## 수정된 로컬 파일

GitHub에 올릴 파일:

```text
index.html
app.css
app.js
```

Apps Script에 붙여넣을 파일:

```text
apps-script/Code.gs
```

이 방식에서는 Apps Script의 `Index.html`, `Styles.html`, `Scripts.html`은 사용하지 않는다.

## GitHub Pages 쪽 설정

`index.html` 하단에 API 주소가 들어가 있다.

```html
<script>
  window.CATV_API_BASE = "https://script.google.com/macros/s/AKfycbw6oTP9zhunIC2HiBHcElPM3337kJnLHpvKjMljcSpYK-k2v4M_Ylfs6Egig5kqEpUZMA/exec";
</script>
```

GitHub Pages에 배포할 때 CSS/JS 경로는 프로젝트 페이지에서도 깨지지 않도록 상대 경로를 사용한다.

```html
<link rel="stylesheet" href="./app.css?v=14" />
<script src="./app.js?v=16"></script>
```

## Apps Script 쪽 설정

`apps-script/Code.gs`를 Apps Script 프로젝트의 `Code.gs`에 전체 붙여넣는다.

`doGet(e)`는 두 가지로 동작한다.

- `action` 파라미터가 없으면 기존 HTML 웹앱 화면을 반환
- `action` 파라미터가 있으면 JSONP API 응답 반환

GitHub Pages에서는 아래처럼 호출된다.

```text
/exec?action=bootstrap
/exec?action=history
/exec?action=start
/exec?action=fiberSave
/exec?action=signal
/exec?action=signalSave
```

## 배포 순서

1. GitHub 저장소에 `index.html`, `app.css`, `app.js` 커밋
2. Apps Script에 최신 `apps-script/Code.gs` 붙여넣기
3. Apps Script 저장
4. `배포 > 배포 관리 > 새 버전 > 배포`
5. GitHub Pages URL 새로고침

## 왜 JSONP인가

GitHub Pages에서 Apps Script를 일반 `fetch POST`로 호출하면 CORS 문제에 걸릴 수 있다.

그래서 현재 프론트는 `<script>` 태그를 동적으로 삽입하는 JSONP 방식으로 Apps Script API를 호출한다. 이 방식은 GitHub Pages 정적 사이트에서도 스프레드시트 읽기/쓰기 응답을 받을 수 있다.

## 주의

- GitHub Pages에는 빠른 화면만 둔다.
- 실제 저장은 Apps Script가 처리한다.
- Apps Script 배포 URL이 바뀌면 `index.html`의 `window.CATV_API_BASE`도 바꿔야 한다.
- 코드 수정 뒤에는 GitHub Pages 캐시 때문에 `app.js?v=16` 같은 버전 숫자를 올리는 것이 좋다.
