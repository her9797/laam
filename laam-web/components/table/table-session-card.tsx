"use client";

import { FormEvent, useEffect, useState } from "react";

import { getStoredTableNumber, normalizeTableNumber, setStoredTableNumber } from "@/lib/table-session";

type TableSessionCardProps = {
  autoOpenIfMissing?: boolean;
  onTableChange?: (tableNumber: string) => void;
};

export function TableSessionCard({
  autoOpenIfMissing = false,
  onTableChange,
}: TableSessionCardProps) {
  const [tableNumber, setTableNumber] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const stored = getStoredTableNumber();
    setTableNumber(stored);
    setDraft(stored);
    onTableChange?.(stored);

    if (autoOpenIfMissing && !stored) {
      setIsOpen(true);
    }
  }, [autoOpenIfMissing, onTableChange]);

  function openEditor() {
    setDraft(tableNumber);
    setError("");
    setIsOpen(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalized = normalizeTableNumber(draft);
    if (!normalized) {
      setError("테이블 번호를 입력해주세요.");
      return;
    }

    const nextTableNumber = setStoredTableNumber(normalized);
    setTableNumber(nextTableNumber);
    onTableChange?.(nextTableNumber);
    setError("");
    setIsOpen(false);
  }

  return (
    <>
      <section className="content-card table-session-card">
        <div className="section-header table-session-header">
          <div>
            <p className="section-kicker">table</p>
            <h2>현재 자리</h2>
          </div>
          <button
            type="button"
            className="table-session-action"
            onClick={openEditor}
          >
            {tableNumber ? "변경" : "선택"}
          </button>
        </div>
        <p className="table-session-copy">
          {tableNumber
            ? `현재 요청은 테이블 ${tableNumber} 기준으로 전달됩니다.`
            : "요청을 남기기 전에 현재 앉아 있는 테이블 번호를 먼저 선택해주세요."}
        </p>
        <div className="table-session-pill-row">
          <span className={tableNumber ? "table-session-pill active" : "table-session-pill"}>
            {tableNumber ? `테이블 ${tableNumber}` : "테이블 미선택"}
          </span>
        </div>
      </section>

      {isOpen ? (
        <div
          className="table-session-modal-backdrop"
          role="presentation"
          onClick={() => {
            setIsOpen(false);
            setError("");
          }}
        >
          <div
            className="table-session-modal"
            role="dialog"
            aria-modal="true"
            aria-label="테이블 선택"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="table-session-modal-header">
              <div>
                <p className="section-kicker">table</p>
                <h2>테이블 번호 선택</h2>
              </div>
              <button
                type="button"
                className="table-session-modal-close"
                onClick={() => {
                  setIsOpen(false);
                  setError("");
                }}
              >
                닫기
              </button>
            </div>
            <form className="request-compose-form" onSubmit={handleSubmit}>
              <label className="request-compose-field">
                <span>테이블 번호</span>
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="예: 7, A-2"
                  autoFocus
                />
              </label>
              {error ? <p className="table-session-error">{error}</p> : null}
              <button className="request-compose-button" type="submit">
                이 자리로 설정
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
