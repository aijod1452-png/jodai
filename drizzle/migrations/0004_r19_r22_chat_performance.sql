CREATE TABLE public.prompt_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_hash text NOT NULL,
  model_id text NOT NULL,
  response text NOT NULL,
  model_display_name text NOT NULL DEFAULT '',
  hit_count integer NOT NULL DEFAULT 0,
  cost_saved numeric NOT NULL DEFAULT 0,
  original_cost numeric NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_hash, model_id)
);
GRANT ALL ON public.prompt_cache TO service_role;
ALTER TABLE public.prompt_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_direct_access ON public.prompt_cache FOR ALL TO anon, authenticated USING (false);

CREATE TABLE public.ai_snippets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command text NOT NULL UNIQUE,
  label text NOT NULL,
  template text NOT NULL,
  system_instruction text NOT NULL DEFAULT '',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ai_snippets TO service_role;
ALTER TABLE public.ai_snippets ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_direct_access ON public.ai_snippets FOR ALL TO anon, authenticated USING (false);
INSERT INTO public.ai_snippets (command, label, template, system_instruction) VALUES
 ('line', 'ส่งไลน์', 'ส่งข้อความ LINE ตามนี้: {input}', 'ผู้ใช้ต้องการส่งข้อความ LINE ให้เรียกเครื่องมือ LINE ที่เปิดใช้งานด้วย JSON ตามรูปแบบ sample_request หากไม่ระบุปลายทางให้ถามกลับ'),
 ('sum', 'สรุปประเด็น', 'สรุปประเด็นสำคัญของข้อความต่อไปนี้เป็นข้อ ๆ:\n{input}', 'สรุปให้กระชับ เป็นหัวข้อย่อย ไม่เกิน 7 ข้อ ห้ามแต่งข้อมูลเพิ่ม'),
 ('fix', 'ตรวจแก้บั๊ก', 'ตรวจหาบั๊กและเสนอโค้ดที่แก้แล้วสำหรับ:\n{input}', 'ทำหน้าที่ผู้ตรวจโค้ด ระบุสาเหตุของบั๊ก แล้วให้โค้ดที่แก้แล้วพร้อมคำอธิบายสั้น ๆ')
ON CONFLICT (command) DO NOTHING;

CREATE TABLE public.user_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  source text NOT NULL DEFAULT 'chat',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.user_memories TO service_role;
ALTER TABLE public.user_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_direct_access ON public.user_memories FOR ALL TO anon, authenticated USING (false);

CREATE TABLE public.chat_summaries (
  conversation_id uuid PRIMARY KEY,
  summary text NOT NULL,
  turns_covered integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.chat_summaries TO service_role;
ALTER TABLE public.chat_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_direct_access ON public.chat_summaries FOR ALL TO anon, authenticated USING (false);