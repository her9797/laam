"use client";

import { FormEvent, useEffect, useState } from "react";

import { getStoredTableNumber, normalizeTableNumber, setStoredTableNumber } from "@/lib/table-session";

function formatTableLabel(tableNumber: string) {
  if (!tableNumber) {
    return "TABLE";
  }

  const normalized = tableNumber.toUpperCase();
  if (/^[TB]-\d{1,2}$/.test(normalized)) {
    const [area, number] = normalized.split("-");
    return `${area}-${number.padStart(2, "0")}`;
  }

  if (/^\d{1,2}$/.test(normalized)) {
    return `T-${normalized.padStart(2, "0")}`;
  }

  return `T-${normalized}`;
}

export function TableSessionBadge({ canEdit = false }: { canEdit?: boolean }) {
  const [tableNumber, setTableNumber] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const tableFromQr = normalizeTableNumber(url.searchParams.get("table") ?? "");
    if (tableFromQr) {
      setStoredTableNumber(tableFromQr);
      url.searchParams.delete("table");
      window.history.replaceState({}, "", url);
    }

    const stored = getStoredTableNumber();
    setTableNumber(stored);
    setDraft(stored);
  }, []);

  const label = canEdit ? "STAFF" : formatTableLabel(tableNumber);

  if (!canEdit) {
    return <span className="floating-table-badge">{label}</span>;
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
    setDraft(nextTableNumber);
    setError("");
    setIsOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="floating-table-badge"
        onClick={() => {
          setDraft(tableNumber);
          setError("");
          setIsOpen(true);
        }}
      >
        <span>{label}</span>
      </button>

      {isOpen ? (
        <div
          className="table-session-modal-backdrop"
          role="presentation"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="table-session-modal"
            role="dialog"
            aria-modal="true"
            aria-label="테이블 번호 변경"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="table-session-modal-header">
              <div>
                <p className="section-kicker">table</p>
                <h2>현재 자리</h2>
              </div>
              <button type="button" className="table-session-modal-close" onClick={() => setIsOpen(false)}>
                닫기
              </button>
            </div>
            <form className="request-compose-form" onSubmit={handleSubmit}>
              <label className="request-compose-field">
                <span>테이블 번호</span>
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="예: 1, A-2"
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
