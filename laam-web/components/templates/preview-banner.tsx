import type { CustomerTemplate } from "@/lib/customer-template";

const TEMPLATE_LABELS: Record<CustomerTemplate, string> = {
  classic: "기본(다크)",
  notebook: "공책",
  chalkboard: "칠판",
};

export function PreviewBanner({ template }: { template: CustomerTemplate }) {
  return (
    <div className="template-preview-banner" role="status">
      <span>
        미리보기 중 · {TEMPLATE_LABELS[template]} <small>주문·요청은 보낼 수 없어요</small>
      </span>
      {/* 라우트 핸들러로 가야 쿠키가 지워지므로 Link 대신 a를 쓴다. */}
      <a href="/preview/exit">종료</a>
    </div>
  );
}
