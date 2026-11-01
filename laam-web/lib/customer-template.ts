import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 손님 화면 템플릿. 관리자가 고른 값은 bootstrap의 `store.customerTemplate`로
 * 오고, 허용 목록은 laam-api의 목록과 같아야 한다.
 */
export const CUSTOMER_TEMPLATES = ["classic", "notebook", "chalkboard"] as const;

export type CustomerTemplate = (typeof CUSTOMER_TEMPLATES)[number];

export const DEFAULT_CUSTOMER_TEMPLATE: CustomerTemplate = "classic";

export const PREVIEW_COOKIE_NAME = "lam_template_preview";

/** laam-api가 미리보기 링크에 넣는 만료와 같은 30분. */
export const PREVIEW_MAX_AGE_SECONDS = 30 * 60;

// 서버 시계가 조금 어긋나도 막 발급한 링크가 거절되지 않게 둔 여유.
const PREVIEW_CLOCK_SKEW_SECONDS = 60;

export function isCustomerTemplate(value: unknown): value is CustomerTemplate {
  return typeof value === "string" && (CUSTOMER_TEMPLATES as readonly string[]).includes(value);
}

/** 값이 없거나 모르는 값이면(API 실패로 로컬 데이터를 쓸 때 포함) 지금 화면인 classic. */
export function resolveCustomerTemplate(value: unknown): CustomerTemplate {
  return isCustomerTemplate(value) ? value : DEFAULT_CUSTOMER_TEMPLATE;
}

function hmacHex(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * laam-api `POST /api/v1/admin/store-template/preview`와 같은 서명.
 * 테이블 QR 서명(HMAC(테이블 id))과 섞이지 않게 `preview:`를 앞에 붙인다.
 */
export function signPreviewLink(secret: string, template: string, exp: string) {
  return hmacHex(secret, `preview:${template}:${exp}`);
}

type PreviewLinkParams = { template: string | null; exp: string | null; sig: string | null };
type VerifyOptions = { secret: string; now: number };

export function verifyPreviewLink({ template, exp, sig }: PreviewLinkParams, { secret, now }: VerifyOptions) {
  if (!secret || !template || !exp || !sig || !isCustomerTemplate(template) || !/^\d+$/.test(exp)) {
    return null;
  }

  const expiresAt = Number(exp);
  if (expiresAt < now || expiresAt > now + PREVIEW_MAX_AGE_SECONDS + PREVIEW_CLOCK_SKEW_SECONDS) {
    return null;
  }

  return safeEqual(sig, signPreviewLink(secret, template, exp)) ? template : null;
}

/** 미리보기 쿠키: `템플릿.만료.서명`. 서명은 세션 쿠키와 같은 SESSION_SECRET로 한다. */
export function createPreviewCookieValue(template: CustomerTemplate, expiresAt: number, secret: string) {
  const payload = `${template}.${expiresAt}`;
  return `${payload}.${hmacHex(secret, `preview-cookie:${payload}`)}`;
}

export function readPreviewCookie(value: string | undefined, { secret, now }: VerifyOptions) {
  const parts = value?.split(".");
  if (!parts || parts.length !== 3) {
    return null;
  }

  const [template, expRaw, signature] = parts;
  const expiresAt = Number(expRaw);
  if (!isCustomerTemplate(template) || !Number.isFinite(expiresAt) || expiresAt < now) {
    return null;
  }

  return safeEqual(signature, hmacHex(secret, `preview-cookie:${template}.${expRaw}`)) ? template : null;
}
