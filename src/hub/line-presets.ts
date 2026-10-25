// LINE tool template and run presets shared by the tool form, the Run Tool dialog and tests.
export const LINE_ACCOUNT = "ObOG";

export const LINE_TOOL_TEMPLATE = {
  description: "ส่งข้อความ LINE ผ่านบัญชี ObOG",
  sampleRequest: { account: LINE_ACCOUNT, to: "Bomb", message: "ทดสอบจาก JodAI" },
};

export interface LineRunPreset {
  id: string;
  label: string;
  payload: { account: string; to: string; message: string };
}

export const LINE_RUN_PRESETS: LineRunPreset[] = [
  { id: "line-bomb", label: "LINE → Bomb", payload: { account: LINE_ACCOUNT, to: "Bomb", message: "ทดสอบจาก JodAI" } },
  { id: "line-xauusd", label: "LINE → XAUUSD", payload: { account: LINE_ACCOUNT, to: "XAUUSD", message: "ทดสอบจาก JodAI" } },
];
