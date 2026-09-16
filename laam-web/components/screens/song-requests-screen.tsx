"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";

import { FloatingHomeBadge } from "@/components/navigation/floating-home-badge";
import { PrimaryNav } from "@/components/navigation/primary-nav";
import { ScrollTopButton } from "@/components/navigation/scroll-top-button";
import type { StoreInfo } from "@/data/menu-data";
import { getStoredTableNumber } from "@/lib/table-session";
import { createCustomerRequest } from "@/services/customer-request-service";

type SongRequestsScreenProps = {
  store: StoreInfo;
};

export function SongRequestsScreen({ store }: SongRequestsScreenProps) {
  const [tableNumber, setTableNumber] = useState("");
  const [song, setSong] = useState("");
  const [artist, setArtist] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setTableNumber(getStoredTableNumber());
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tableNumber) {
      setFeedback("메인 화면에서 먼저 테이블 번호를 선택해주세요.");
      return;
    }

    if (!song.trim()) {
      setFeedback("신청할 곡을 입력해주세요.");
      return;
    }

    startTransition(async () => {
      try {
        await createCustomerRequest({
          tableNumber,
          text: `[노래 신청] ${song.trim()}${artist.trim() ? ` - ${artist.trim()}` : ""}`,
        });
        setSong("");
        setArtist("");
        setFeedback("노래 신청을 전달했어요.");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "노래 신청 전달에 실패했습니다.");
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
          <h1>노래신청</h1>
          <p className="hero-copy">{store.songRequestCopy}</p>
        </header>

        <PrimaryNav active="song-requests" />

        <section className="content-card request-compose-card">
          <div className="section-header">
            <div>
              <p className="section-kicker">music request</p>
              <h2>듣고 싶은 노래</h2>
            </div>
          </div>
          <form className="request-compose-form" onSubmit={handleSubmit}>
            <label className="request-compose-field">
              <span>곡명</span>
              <input value={song} onChange={(event) => setSong(event.target.value)} placeholder="예: Ditto" />
            </label>
            <label className="request-compose-field">
              <span>아티스트</span>
              <input value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="예: NewJeans" />
            </label>
            <button className="request-compose-button" type="submit" disabled={isPending}>
              {isPending ? "전달 중..." : "노래 신청 보내기"}
            </button>
          </form>
        </section>
      </div>
      {feedback ? (
        <div className="request-toast" role="status" aria-live="polite">
          {feedback}
        </div>
      ) : null}
    </main>
  );
}
