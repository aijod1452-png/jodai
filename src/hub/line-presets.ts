// LINE Bridge payload contract (real API spec): { requestId, lineAccount, destination, message: { type, text } }.
// Shared by the tool form, the Run Tool dialog and tests.
export const LINE_ACCOUNT = "ObOG";

export interface LineBridgePayload {
  requestId: string;
  lineAccount: string;
  destination: string;
  message: { type: "text"; text: string };
}

/** requestId is freshly randomized on every call so each run is unique. */
export function buildLinePayload(destination: string, text: string, requestId: string = crypto.randomUUID()): LineBridgePayload {
  return { requestId, lineAccount: LINE_ACCOUNT, destination, message: { type: "text", text } };
}

export const LINE_TOOL_TEMPLATE = {
  description: "ส่งข้อความ LINE ผ่านบัญชี ObOG (LINE Bridge)",
  sampleRequest: { requestId: "unique-request-id", lineAccount: LINE_ACCOUNT, destination: "Bomb", message: { type: "text", text: "ทดสอบจาก JodAI" } } as LineBridgePayload,
};

export interface LineRunPreset {
  id: string;
  label: string;
  destination: string;
}

export const LINE_RUN_PRESETS: LineRunPreset[] = [
  { id: "line-bomb", label: "LINE → Bomb", destination: "Bomb" },
  { id: "line-xauusd", label: "LINE → XAUUSD", destination: "XAUUSD" },
];

/** Builds a preset payload with a freshly randomized requestId every time it is selected. */
export function buildPresetPayload(preset: LineRunPreset): LineBridgePayload {
  return buildLinePayload(preset.destination, "ทดสอบจาก JodAI");
}
