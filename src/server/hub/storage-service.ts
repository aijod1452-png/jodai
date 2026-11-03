import { encryptSecret, decryptSecret } from "./core";
import { normalizeProjectUrl, normalizeBucketName, normalizeStorageKey, testStorageConnection, type ExternalSnapshotTarget } from "./storage-connection";
import { createR2Adapter, executeR2Operation, r2Endpoint, r2Bucket, r2Credentials, R2Error } from "./r2-storage";

export const STORAGE_PUBLIC_COLUMNS = "id,name,project_url,bucket_name,storage_type,account_id,is_enabled,last_test_result,last_test_latency_ms,last_tested_at,created_at,updated_at";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (value: any) => Array.isArray(value) ? value[0] : value;
export async function loadStorage(client: any, id: unknown) {
  if (typeof id !== "string" || !uuid.test(id)) throw new R2Error("INVALID_STORAGE_ID");
  const { data, error } = await client.from("storage_connections").select("*,storage_secrets(encrypted_secret,encryption_iv,service_role_key)").eq("id", id).maybeSingle();
  if (error) throw new R2Error("CONFIGURATION_READ_FAILED");
  if (!data || !data.is_enabled) throw new R2Error("STORAGE_UNAVAILABLE");
  return data;
}
export async function storageTarget(storage: any): Promise<ExternalSnapshotTarget> {
  const sec = one(storage.storage_secrets);
  let key: string;
  try { key = await decryptSecret(sec?.encrypted_secret || null, sec?.encryption_iv || null, storage.storage_type === "r2" ? null : sec?.service_role_key); } catch { throw new R2Error("CREDENTIAL_DECRYPT_FAILED"); }
  if (storage.storage_type === "r2") {
    let credentials; try { const parsed = JSON.parse(key); credentials = r2Credentials(parsed.accessKeyId, parsed.secretAccessKey); } catch { throw new R2Error("CREDENTIAL_CONFIGURATION"); }
    return { type: "r2", accountId: storage.account_id, bucketName: storage.bucket_name, ...credentials };
  }
  return { projectUrl: storage.project_url, key, bucketName: normalizeBucketName(storage.bucket_name) };
}
export async function saveStorage(client: any, body: any) {
  const { id, name, bucketName, isEnabled } = body;
  if (id != null && (typeof id !== "string" || !uuid.test(id))) throw new R2Error("INVALID_STORAGE_ID");
  if (typeof name !== "string" || !name.trim() || name.length > 100) throw new R2Error("INVALID_NAME");
  const type = body.storageType ?? "supabase";
  if (!["r2", "supabase"].includes(type)) throw new R2Error("INVALID_PROVIDER");
  let existing: any;
  if (id) { const { data, error } = await client.from("storage_connections").select("storage_type,account_id,project_url").eq("id", id).maybeSingle(); if (error || !data) throw new R2Error("STORAGE_UNAVAILABLE"); existing = data; }
  let secret = ""; let projectUrl: string; let accountId: string | null = null; let bucket: string;
  try {
    if (type === "r2") {
      accountId = String(body.accountId ?? "").trim().toLowerCase(); projectUrl = r2Endpoint(accountId); bucket = r2Bucket(bucketName);
      if (body.accessKeyId || body.secretAccessKey) secret = JSON.stringify(r2Credentials(body.accessKeyId, body.secretAccessKey));
    } else {
      projectUrl = normalizeProjectUrl(body.projectUrl); bucket = normalizeBucketName(bucketName);
      if (body.serviceRoleKey) secret = normalizeStorageKey(body.serviceRoleKey);
    }
  } catch { throw new R2Error("INVALID_CONFIGURATION"); }
  if (!secret && (!existing || existing.storage_type !== type || (type === "r2" && existing.account_id !== accountId))) throw new R2Error("CREDENTIAL_REQUIRED");
  // Complete validation/encryption before any database changes.
  const encrypted = secret ? await encryptSecret(secret) : null;
  const record = { name: name.trim(), storage_type: type, account_id: accountId, project_url: projectUrl, bucket_name: bucket, is_enabled: isEnabled !== false, updated_at: new Date().toISOString() };
  let storageId = id;
  if (id) { const { data, error } = await client.from("storage_connections").update(record).eq("id", id).select("id"); if (error || !data?.length) throw new R2Error("SAVE_FAILED"); }
  else { const { data, error } = await client.from("storage_connections").insert(record).select("id").single(); if (error || !data) throw new R2Error("SAVE_FAILED"); storageId = data.id; }
  if (encrypted) { const { error } = await client.from("storage_secrets").upsert({ storage_id: storageId, ...encrypted, service_role_key: null, masked_key: "ตั้งค่าคีย์แล้ว" }); if (error) throw new R2Error("CREDENTIAL_SAVE_FAILED"); }
  return { success: true, id: storageId };
}
export async function probeStorage(client: any, id: unknown, fetcher: typeof fetch = fetch) {
  const st = await loadStorage(client, id); const start = Date.now();
  let result;
  try { const target = await storageTarget(st); result = target.type === "r2" ? { ...await createR2Adapter(target, fetcher).probe(), attempts: [] } : await testStorageConnection(target.projectUrl, target.key, fetcher, target.bucketName); }
  catch { result = { success: false, latency: Date.now() - start, attempts: [], message: "ตรวจการตั้งค่า/คีย์ Storage ไม่สำเร็จ กรุณาบันทึกใหม่" }; }
  const { error } = await client.from("storage_connections").update({ last_test_result: result.success ? "SUCCESS" : "FAILED", last_test_latency_ms: result.latency, last_tested_at: new Date().toISOString() }).eq("id", id);
  const { error: auditError } = await client.from("activity_log").insert({ event_type: "STORAGE_PROBE", description: "ตรวจ Storage แบบอ่านอย่างเดียว", details: { storageId: id, provider: st.storage_type, success: result.success, latencyMs: result.latency, status: "status" in result ? result.status : result.attempts[0]?.status ?? null } });
  return error || auditError ? { ...result, warning: "ไม่สามารถบันทึกผลทดสอบหรือประวัติได้" } : result;
}
export async function runStorageOperation(client: any, storageId: unknown, input: unknown, fetcher: typeof fetch = fetch) {
  const st = await loadStorage(client, storageId); if (st.storage_type !== "r2") throw new R2Error("R2_REQUIRED");
  const start = Date.now(); let result: any; let failure: R2Error | undefined;
  try { const target = await storageTarget(st); if (target.type !== "r2") throw new R2Error("R2_REQUIRED"); result = await executeR2Operation(createR2Adapter(target, fetcher), input); }
  catch (e) { failure = e instanceof R2Error ? e : new R2Error("CONFIGURATION"); }
  const operation = input && typeof input === "object" && "operation" in input && ["list", "read", "write"].includes(String(input.operation)) ? String(input.operation) : "rejected";
  const details = { storageId, provider: "r2", operation, success: !failure, status: result?.status ?? failure?.status ?? null, latencyMs: Date.now() - start, bytes: result?.bytes ?? null, count: result?.objects?.length ?? null, error: failure?.code ?? null };
  const { error } = await client.from("activity_log").insert({ event_type: "R2_OPERATION", description: `R2 ${operation}`, details });
  if (error) throw new R2Error("AUDIT_FAILED", result?.status ?? null);
  if (failure) throw failure;
  return { ...result, latency: details.latencyMs };
}
export function storageChatTools(storages: any[]) {
  return storages.filter(st => st.is_enabled && st.storage_type === "r2").map(st => ({ id: `r2:${st.id}`, storageId: st.id, kind: "r2" as const, name: `R2 ${st.name}`, description: `Bucket ${st.bucket_name}: list/read/write only. payload list={operation:"list",prefix:""}; read={operation:"read",path:"file.txt"}; write={operation:"write",path:"file.txt",contentType:"text/plain",content:"..."}. Text/JSON/CSV only, max 1 MiB. No delete or URLs.`, base_url: "", sample_request: { operation: "list" } }));
}