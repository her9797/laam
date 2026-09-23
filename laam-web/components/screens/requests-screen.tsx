"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import confetti from "canvas-confetti";

import { SecretCouponModal } from "@/components/easter-egg/secret-coupon-hotspot";
import { FloatingHomeBadge } from "@/components/navigation/floating-home-badge";
import { PrimaryNav } from "@/components/navigation/primary-nav";
import { ScrollTopButton } from "@/components/navigation/scroll-top-button";
import {
  createCustomerRequest,
  type CustomerRequestGender,
  createSpecialRequest,
} from "@/services/customer-request-service";
import type { StoreInfo } from "@/data/menu-data";
import { getStoredTableNumber } from "@/lib/table-session";
import type { SecretCouponClaim } from "@/services/secret-coupon-service";

type RequestsScreenProps = {
  store: StoreInfo;
  initialCategory: "direct" | "special";
};

type SpecialFormState = {
  gender: CustomerRequestGender;
  name: string;
  age: string;
  residence: string;
  instagram: string;
  idealHeight: string;
  idealResidence: string;
  idealAgeRange: string;
  idealDetails: string;
  text: string;
};

const defaultSpecialForm: SpecialFormState = {
  gender: "male",
  name: "",
  age: "",
  residence: "",
  instagram: "",
  idealHeight: "",
  idealResidence: "",
  idealAgeRange: "",
  idealDetails: "",
  text: "",
};

export function RequestsScreen({ store, initialCategory }: RequestsScreenProps) {
  const activeCategory = initialCategory;
  const [tableNumber, setTableNumber] = useState("");
  const [message, setMessage] = useState("");
  const [specialForm, setSpecialForm] =
    useState<SpecialFormState>(defaultSpecialForm);
  const [feedback, setFeedback] = useState("");
  const [secretCoupon, setSecretCoupon] = useState<SecretCouponClaim | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setTableNumber(getStoredTableNumber());
  }, []);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timer = window.setTimeout(() => {
      setFeedback("");
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [feedback]);

  function handleDirectSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextMessage = message.trim();
    if (!tableNumber) {
      setFeedback("메인 화면에서 먼저 테이블 번호를 선택해주세요.");
      return;
    }

    if (!nextMessage) {
      setFeedback("남기실 내용을 입력해주세요.");
      return;
    }

    startTransition(async () => {
      try {
        await createCustomerRequest({
          tableNumber,
          text: nextMessage,
        });
        setMessage("");
        setFeedback("평범한 요청을 남겼어요.");
      } catch (error) {
        setFeedback(
          error instanceof Error
            ? error.message
            : "전달 중 문제가 발생했습니다.",
        );
      }
    });
  }

  function handleSpecialSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !tableNumber ||
      !specialForm.name.trim() ||
      !specialForm.age.trim() ||
      !specialForm.residence.trim() ||
      !specialForm.instagram.trim() ||
      !specialForm.idealHeight.trim() ||
      !specialForm.idealResidence.trim() ||
      !specialForm.idealAgeRange.trim() ||
      !specialForm.idealDetails.trim() ||
      !specialForm.text.trim()
    ) {
      setFeedback(
        tableNumber
          ? "특별한 폼의 모든 항목을 입력해주세요."
          : "메인 화면에서 먼저 테이블 번호를 선택해주세요.",
      );
      return;
    }

    startTransition(async () => {
      try {
        const result = await createSpecialRequest({
          tableNumber,
          gender: specialForm.gender,
          name: specialForm.name.trim(),
          age: specialForm.age.trim(),
          residence: specialForm.residence.trim(),
          instagram: specialForm.instagram.trim(),
          idealHeight: specialForm.idealHeight.trim(),
          idealResidence: specialForm.idealResidence.trim(),
          idealAgeRange: specialForm.idealAgeRange.trim(),
          idealDetails: specialForm.idealDetails.trim(),
          text: specialForm.text.trim(),
        });
        setSpecialForm(defaultSpecialForm);
        setFeedback("특별한 요청을 전달했어요.");
        setSecretCoupon(result.secretCoupon ?? null);
        if (result.secretCoupon) {
          confetti({
            particleCount: 140,
            spread: 90,
            origin: { y: 0.6 },
          });
        }
      } catch (error) {
        setFeedback(
          error instanceof Error
            ? error.message
            : "전달 중 문제가 발생했습니다.",
        );
      }
    });
  }

  return (
    <main className="page-shell">
      <FloatingHomeBadge />
      <ScrollTopButton />
      <div className="phone-frame">
        <header className="hero-card compact">
          <p className="eyebrow">BAR LAAM</p>
          <h1>{activeCategory === "special" ? "특별한 요청" : "사장님께 한마디"}</h1>
          <p className="hero-copy">
            {activeCategory === "special"
              ? "특별한 요청을 남겨주세요."
              : store.requestCopy}
          </p>
        </header>

        <PrimaryNav
          active={activeCategory === "special" ? "special-requests" : "requests"}
        />

        {activeCategory === "direct" ? (
          <section className="content-card request-compose-card">
            <div className="section-header">
              <div>
                <p className="section-kicker">direct</p>
                <h2>평범한</h2>
              </div>
            </div>
            <form className="request-compose-form" onSubmit={handleDirectSubmit}>
              <label className="request-compose-field">
                <span>남기실 내용</span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="예: 얼음 적게 부탁드려요. 조용한 자리 있으면 좋겠어요."
                />
              </label>
              <button
                className="request-compose-button"
                type="submit"
                disabled={isPending}
              >
                {isPending ? "전달 중..." : "사장님께 보내기"}
              </button>
            </form>
          </section>
        ) : (
          <section className="content-card request-compose-card">
            <div className="section-header">
              <div>
                <p className="section-kicker">special</p>
                <h2>특별한</h2>
              </div>
            </div>
            <form className="request-compose-form request-compose-form-grid" onSubmit={handleSpecialSubmit}>
              <label className="request-compose-field">
                <span>성별</span>
                <select
                  value={specialForm.gender}
                  onChange={(event) =>
                    setSpecialForm((current) => ({
                      ...current,
                      gender: event.target.value as CustomerRequestGender,
                    }))
                  }
                >
                  <option value="male">남자</option>
                  <option value="female">여자</option>
                </select>
              </label>
              <label className="request-compose-field">
                <span>이름</span>
                <input
                  value={specialForm.name}
                  onChange={(event) =>
                    setSpecialForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="이름을 입력해주세요"
                />
              </label>
              <label className="request-compose-field">
                <span>나이</span>
                <input
                  value={specialForm.age}
                  onChange={(event) =>
                    setSpecialForm((current) => ({
                      ...current,
                      age: event.target.value,
                    }))
                  }
                  placeholder="나이를 입력해주세요"
                />
              </label>
              <label className="request-compose-field">
                <span>사는 곳</span>
                <input
                  value={specialForm.residence}
                  onChange={(event) =>
                    setSpecialForm((current) => ({
                      ...current,
                      residence: event.target.value,
                    }))
                  }
                  placeholder="예: 성수, 잠실"
                />
              </label>
              <label className="request-compose-field">
                <span>연락처 (인스타그램)</span>
                <input
                  value={specialForm.instagram}
                  onChange={(event) =>
                    setSpecialForm((current) => ({
                      ...current,
                      instagram: event.target.value,
                    }))
                  }
                  placeholder="예: @your_instagram"
                />
              </label>
              <fieldset className="request-compose-field-wide request-compose-fieldset">
                <legend className="request-compose-fieldset-legend">이상형</legend>
                <div className="request-compose-fieldset-grid">
                  <label className="request-compose-field">
                    <span>키</span>
                    <input
                      value={specialForm.idealHeight}
                      onChange={(event) =>
                        setSpecialForm((current) => ({
                          ...current,
                          idealHeight: event.target.value,
                        }))
                      }
                      placeholder="예: 175cm 이상"
                    />
                  </label>
                  <label className="request-compose-field">
                    <span>거주지</span>
                    <input
                      value={specialForm.idealResidence}
                      onChange={(event) =>
                        setSpecialForm((current) => ({
                          ...current,
                          idealResidence: event.target.value,
                        }))
                      }
                      placeholder="예: 성수, 잠실"
                    />
                  </label>
                  <label className="request-compose-field">
                    <span>연령대</span>
                    <input
                      value={specialForm.idealAgeRange}
                      onChange={(event) =>
                        setSpecialForm((current) => ({
                          ...current,
                          idealAgeRange: event.target.value,
                        }))
                      }
                      placeholder="예: 20대 초반~중반"
                    />
                  </label>
                  <label className="request-compose-field request-compose-field-wide">
                    <span>세부사항</span>
                    <input
                      value={specialForm.idealDetails}
                      onChange={(event) =>
                        setSpecialForm((current) => ({
                          ...current,
                          idealDetails: event.target.value,
                        }))
                      }
                      placeholder="어떤 사람이 이상형인지 자유롭게 적어주세요"
                    />
                  </label>
                </div>
              </fieldset>
              <label className="request-compose-field request-compose-field-wide">
                <span>하고 싶은 말</span>
                <textarea
                  value={specialForm.text}
                  onChange={(event) =>
                    setSpecialForm((current) => ({
                      ...current,
                      text: event.target.value,
                    }))
                  }
                  placeholder="자유롭게 남겨주세요"
                />
              </label>
              <button
                className="request-compose-button request-compose-button-wide"
                type="submit"
                disabled={isPending}
              >
                {isPending ? "전달 중..." : "특별한 요청 보내기"}
              </button>
            </form>
          </section>
        )}
      </div>
      {feedback ? (
        <div className="request-toast" role="status" aria-live="polite">
          {feedback}
        </div>
      ) : null}
      {secretCoupon ? <SecretCouponModal claim={secretCoupon} onClose={() => setSecretCoupon(null)} /> : null}
    </main>
  );
}
