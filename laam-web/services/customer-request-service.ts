export type CustomerRequestGender = "male" | "female";

export type CustomerRequestInput = {
  tableNumber: string;
  text: string;
};

export type SpecialRequestInput = {
  tableNumber: string;
  gender: CustomerRequestGender;
  name: string;
  age: string;
  residence: string;
  instagram: string;
  idealType: string;
  text: string;
};

async function readError(response: Response) {
  const errorBody = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;

  return errorBody?.error ?? `request failed: ${response.status}`;
}

export async function createCustomerRequest(payload: CustomerRequestInput) {
  const response = await fetch("/api/customer-requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }
}

export async function createSpecialRequest(payload: SpecialRequestInput) {
  const response = await fetch("/api/special-requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }
}
