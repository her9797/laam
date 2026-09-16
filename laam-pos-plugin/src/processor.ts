import type { ClaimedOrder } from "./order-sync";

export interface ProcessorDependencies {
  claim(): Promise<ClaimedOrder | undefined>;
  complete(orderID: string, claimToken: string, posOrderID: string): Promise<void>;
  fail(orderID: string, claimToken: string, message: string): Promise<void>;
  getProcessedPOSOrderID(orderID: string): Promise<string | undefined>;
  rememberProcessedPOSOrderID(orderID: string, posOrderID: string): Promise<void>;
  syncToPOS(claim: ClaimedOrder): Promise<string>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "알 수 없는 POS 주문 등록 오류";
}

export async function processNextClaim(dependencies: ProcessorDependencies): Promise<boolean> {
  const claim = await dependencies.claim();
  if (!claim) {
    return false;
  }

  const orderID = claim.order.orderId;
  const rememberedPOSOrderID = await dependencies.getProcessedPOSOrderID(orderID);
  if (rememberedPOSOrderID) {
    await dependencies.complete(orderID, claim.claimToken, rememberedPOSOrderID);
    return true;
  }

  let posOrderID: string;
  try {
    posOrderID = await dependencies.syncToPOS(claim);
  } catch (error) {
    try {
      await dependencies.fail(orderID, claim.claimToken, errorMessage(error));
    } catch (reportError) {
      console.error("lam POS plugin: failed to report order error", reportError);
    }
    throw error;
  }

  await dependencies.rememberProcessedPOSOrderID(orderID, posOrderID);
  await dependencies.complete(orderID, claim.claimToken, posOrderID);
  return true;
}
