export async function createOpenAIResponse(
  apiKey: string,
  payload: Record<string, unknown>
): Promise<any> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string }; message?: string }
    | null;

  if (!response.ok) {
    const message =
      body?.error?.message ??
      body?.message ??
      `OpenAI Responses API request failed with status ${response.status}`;
    throw new Error(message);
  }

  return body;
}
