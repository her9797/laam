"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import type { MenuItem } from "@/data/menu-data";
import { getMenuItemDetail } from "@/lib/menu-item-detail";
import { getMenuOrderTotal, parseWonPrice, validateMenuOptionSelection, type MenuOptionSelection } from "@/lib/menu-options";
import { getStoredTableNumber } from "@/lib/table-session";
import { createOrder } from "@/services/order-service";

type MenuItemCardProps = {
  item: MenuItem;
  imageArea?: "home" | "menu";
};

export function MenuItemCard({ item, imageArea = "menu" }: MenuItemCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isOrdering, setIsOrdering] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [isOrderComplete, setIsOrderComplete] = useState(false);
  const [requestNote, setRequestNote] = useState("");
  const [selectedChoices, setSelectedChoices] = useState<MenuOptionSelection>({});
  const titleId = useId();
  const descriptionId = useId();
  const detail = getMenuItemDetail(item);
  const preferredImages = item.images?.filter((image) =>
    imageArea === "home" ? image.displayArea === "home" || image.displayArea === "both" : image.displayArea === "menu" || image.displayArea === "both",
  );
  const fallbackImages =
    imageArea === "home"
      ? item.images?.filter((image) => image.displayArea === "menu")
      : item.images;
  const candidateImages = preferredImages?.length ? preferredImages : fallbackImages;
  const primaryImage = candidateImages?.find((image) => image.isPrimary) ?? candidateImages?.[0];
  const displayImageURL = item.imageUrl || primaryImage?.contentUrl;
  const displayImageStyle = !item.imageUrl && primaryImage
    ? { objectPosition: `${primaryImage.focusX}% ${primaryImage.focusY}%` }
    : undefined;
  const options = item.options ?? [];
  const totalAmount = getMenuOrderTotal(parseWonPrice(item.price), options, selectedChoices);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function handleOrder() {
    setIsOrdering(true);
    setOrderError("");
    const validationError = validateMenuOptionSelection(options, selectedChoices);
    if (validationError) {
      setOrderError(validationError);
      setIsOrdering(false);
      return;
    }
    try {
      await createOrder({
        menuItemId: item.id,
        tableNumber: getStoredTableNumber(),
        requestNote,
        optionChoices: options.flatMap((option) =>
          option.choices
            .filter((choice) => (selectedChoices[choice.id] ?? 0) > 0)
            .map((choice) => ({
              optionId: option.id,
              optionChoiceId: choice.id,
              quantity: selectedChoices[choice.id],
            })),
        ),
      });
      setIsOrderComplete(true);
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "주문을 시작하지 못했습니다.");
    } finally {
      setIsOrdering(false);
    }
  }

  function openDetail() {
    setOrderError("");
    setIsOrderComplete(false);
    setRequestNote("");
    setSelectedChoices({});
    setIsOpen(true);
  }

  function selectChoice(optionId: string, choiceId: string, maxChoices: number, checked: boolean) {
    setSelectedChoices((current) => {
      const next = { ...current };
      const option = options.find((candidate) => candidate.id === optionId);
      if (maxChoices === 1 && option) {
        for (const choice of option.choices) {
          delete next[choice.id];
        }
      }
      if (checked) {
        next[choiceId] = 1;
      } else {
        delete next[choiceId];
      }
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        className="menu-item menu-item-button"
        aria-haspopup="dialog"
        onClick={openDetail}
      >
        <div className="menu-icon">
          {displayImageURL ? (
            <img
              src={displayImageURL}
              alt={item.name}
              className="menu-icon-image"
              style={displayImageStyle}
            />
          ) : (
            item.name.slice(0, 1)
          )}
        </div>
        <div className="menu-copy">
          <h3>{item.name}</h3>
          <p>{item.description}</p>
        </div>
        <div className="menu-side">
          <span
            className={item.badge ? "menu-badge" : "menu-badge menu-badge-placeholder"}
            data-badge-color={item.badgeColor || "green"}
            aria-hidden={item.badge ? undefined : true}
          >
            {item.badge || "badge"}
          </span>
          <span className="menu-price">{item.price}</span>
        </div>
      </button>

      {isOpen ? createPortal(
        <div
          className="table-session-modal-backdrop"
          role="presentation"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="table-session-modal menu-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={displayImageURL ? "menu-detail-header has-image" : "menu-detail-header"}>
              <div className="menu-detail-summary">
                <p className="section-kicker">menu detail</p>
                <h2 id={titleId}>{detail.name}</h2>
                <p className="menu-detail-price">
                  {totalAmount > 0 ? `${new Intl.NumberFormat("ko-KR").format(totalAmount)}원` : detail.price}
                </p>
              </div>
              {displayImageURL ? (
                <img
                  src={displayImageURL}
                  alt={`${item.name} 상세 이미지`}
                  className="menu-detail-image"
                  style={displayImageStyle}
                />
              ) : null}
            </div>
            <p className="menu-detail-description" id={descriptionId}>
              {detail.description || "메뉴 설명이 준비 중입니다."}
            </p>
            {!isOrderComplete && options.length > 0 ? (
              <div className="menu-detail-options">
                {options.map((option) => {
                  const isSingle = option.maxChoices === 1;
                  return (
                    <fieldset className="menu-option-group" key={option.id}>
                      <legend>
                        {option.title}
                        <span>{option.required ? "필수" : "선택"}</span>
                      </legend>
                      {!option.required && isSingle ? (
                        <label className="menu-option-choice">
                          <input
                            type="radio"
                            name={`option-${option.id}`}
                            checked={!option.choices.some((choice) => (selectedChoices[choice.id] ?? 0) > 0)}
                            onChange={() => {
                              setSelectedChoices((current) => {
                                const next = { ...current };
                                for (const choice of option.choices) {
                                  delete next[choice.id];
                                }
                                return next;
                              });
                            }}
                          />
                          <span>선택 안 함</span>
                        </label>
                      ) : null}
                      {option.choices.map((choice) => {
                        const quantity = selectedChoices[choice.id] ?? 0;
                        return (
                          <div className="menu-option-choice-row" key={choice.id}>
                            <label className="menu-option-choice">
                              <input
                                type={isSingle ? "radio" : "checkbox"}
                                name={`option-${option.id}`}
                                checked={quantity > 0}
                                onChange={(event) => selectChoice(option.id, choice.id, option.maxChoices, event.target.checked)}
                              />
                              <span>{choice.title}</span>
                              <small>{choice.priceValue > 0 ? `+${choice.priceValue.toLocaleString("ko-KR")}원` : "추가금 없음"}</small>
                            </label>
                            {quantity > 0 && choice.quantityEnabled ? (
                              <input
                                className="menu-option-quantity"
                                type="number"
                                aria-label={`${choice.title} 수량`}
                                min={choice.minQuantity}
                                max={choice.maxQuantity}
                                value={quantity}
                                onChange={(event) => {
                                  const parsed = Number(event.target.value);
                                  if (!Number.isFinite(parsed)) {
                                    return;
                                  }
                                  const value = Math.max(choice.minQuantity, Math.min(choice.maxQuantity, parsed));
                                  setSelectedChoices((current) => ({ ...current, [choice.id]: value }));
                                }}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </fieldset>
                  );
                })}
              </div>
            ) : null}
            {!isOrderComplete ? (
              <label className="request-compose-field menu-detail-request-field">
                <span>요청사항 (선택)</span>
                <textarea
                  value={requestNote}
                  maxLength={200}
                  placeholder="예: 얼음은 적게 주세요"
                  disabled={isOrdering}
                  onChange={(event) => setRequestNote(event.target.value)}
                />
              </label>
            ) : null}
            {isOrderComplete ? (
              <p className="menu-detail-order-success" role="status">
                주문이 접수됐어요. 매장에서 결제해 주세요.
              </p>
            ) : null}
            {orderError ? <p className="table-session-error">{orderError}</p> : null}
            <div className="menu-detail-actions">
              {!isOrderComplete ? (
                <button
                  className="request-compose-button menu-detail-order-button"
                  type="button"
                  disabled={isOrdering}
                  onClick={handleOrder}
                >
                  {isOrdering ? "주문 등록 중..." : "주문"}
                </button>
              ) : null}
              <button
                className="table-session-modal-close menu-detail-close-button"
                type="button"
                autoFocus
                onClick={() => setIsOpen(false)}
              >
                닫기
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
