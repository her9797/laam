/** 공책·칠판 홈의 인스타·네이버 아이콘 링크. 색은 템플릿 글자색(currentColor)을 따른다. */
export function SocialLinks({ className }: { className: string }) {
  return (
    <div className={className}>
      <a href="https://www.instagram.com/bar_laam/" target="_blank" rel="noreferrer" aria-label="인스타그램 @bar_laam">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      </a>
      <a href="https://map.naver.com/p/entry/place/2042961708?lng=126.908354&lat=37.5567325&placePath=%2Freview%3FadditionalHeight%3D76%26fromPanelNum%3D1%26locale%3Dko%26svcName%3Dmap_pcv5%26timestamp%3D202609280819&searchType=place&c=15.00,0,0,0,dh" target="_blank" rel="noreferrer" aria-label="네이버 지도">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <path d="M8.5 16.5v-9l7 9v-9" />
        </svg>
      </a>
    </div>
  );
}
